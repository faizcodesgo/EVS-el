const mongoose = require('mongoose')
const SimulationSession = require('../models/SimulationSession')
const Reading = require('../models/Reading')
const Alert = require('../models/Alert')
const AlertEvaluationState = require('../models/AlertEvaluationState')
const WaterBody = require('../models/WaterBody')
const Device = require('../models/Device')
const { ingestTelemetry, validateTelemetry } = require('./telemetryIngestion')

const timers = new Map()
const inFlight = new Map()
const fields = ['temperature', 'pH', 'salinity', 'ammonia']
function variationWave(session, field, index) {
  const value = `${session._id || session.sessionId || 'simulation'}:${field}:${Math.max(0, index)}`
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) / 0xffffffff) * 2 - 1
}

function variesAround(value, amount, session, field, index, waveOverride) {
  const variation = amount * (waveOverride ?? variationWave(session, field, index))
  let result = value + variation
  if (field === 'pH') result = Math.max(0, Math.min(14, result))
  if (field === 'salinity' || field === 'ammonia') result = Math.max(0, result)
  return Number.isFinite(result) ? result : null
}

function baselineVariation(value, session, field, index) {
  const amount = Math.max(Math.abs(value) * 0.02, 0.001)
  if ((field === 'salinity' || field === 'ammonia') && value === 0) {
    return variesAround(value, amount, session, field, index, Math.abs(variationWave(session, field, index)))
  }
  return variesAround(value, amount, session, field, index)
}

function baselineFor(body, seedValues) {
  const baseline = {}
  for (const field of fields) {
    const limits = body.monitoringLimits?.[field]
    if (limits?.enabled && Number.isFinite(limits.min) && Number.isFinite(limits.max)) {
      baseline[field] = (limits.min + limits.max) / 2
    } else if (typeof seedValues?.[field] === 'number' && Number.isFinite(seedValues[field])) {
      baseline[field] = seedValues[field]
    } else {
      return null
    }
  }
  return baseline
}

function sampleFor(session, body, index) {
  const baseline = baselineFor(body, session.seedValues)
  if (!baseline) return null
  const data = {}

  for (const field of fields) {
    const limit = body.monitoringLimits?.[field]
    const configured = Boolean(limit?.enabled && Number.isFinite(limit.min) && Number.isFinite(limit.max))
    if (!configured) {
      data[field] = baselineVariation(baseline[field], session, field, index)
      if (!Number.isFinite(data[field])) return null
      continue
    }

    const span = limit.max - limit.min
    const inRangeAmount = span * 0.08
    const recovering = session.scenario === 'recovery' && index >= Math.ceil(session.sampleCount / 2)
    const recoveryUsesAbove = session.scenario === 'recovery' && field !== 'temperature' && limit.min <= 0
    if (session.scenario === 'above' ||
      (session.scenario === 'recovery' && !recovering && recoveryUsesAbove)) {
      const excursion = Math.max(span * 0.05, Math.abs(limit.max) * 0.01, 0.001)
      data[field] = limit.max + excursion * (1 + 0.2 * variationWave(session, field, index))
    } else if (session.scenario === 'below' ||
      (session.scenario === 'recovery' && !recovering)) {
      let excursion = Math.max(span * 0.05, Math.abs(limit.min) * 0.01, 0.001)
      if (field === 'pH' || field === 'salinity' || field === 'ammonia') excursion = Math.min(excursion, limit.min * 0.4)
      data[field] = limit.min - excursion * (1 + 0.2 * variationWave(session, field, index))
    } else if (session.scenario === 'recovery') {
      data[field] = variesAround((limit.min + limit.max) / 2, inRangeAmount, session, field, index)
    } else {
      data[field] = variesAround(baseline[field], inRangeAmount, session, field, index)
    }
    if (!Number.isFinite(data[field])) return null
  }

  if (session.scenario === 'invalid') {
    data.pH = 15 + Math.abs(variationWave(session, 'pH', index)) * 0.1
  }
  return data
}

function matchesConfiguredLimits(session, body, sample, index) {
  for (const field of fields) {
    const limit = body.monitoringLimits?.[field]
    if (!limit?.enabled) continue
    if (session.scenario === 'above' && !(sample[field] > limit.max)) return false
    if (session.scenario === 'below' && !(sample[field] < limit.min)) return false
    if (session.scenario === 'recovery') {
      const recovering = index >= Math.ceil(session.sampleCount / 2)
      if (recovering && !(sample[field] >= limit.min && sample[field] <= limit.max)) return false
      if (!recovering) {
        const usesAbove = field !== 'temperature' && limit.min <= 0
        if (usesAbove ? !(sample[field] > limit.max) : !(sample[field] < limit.min)) return false
      }
    }
    if (session.scenario === 'normal' && !(sample[field] >= limit.min && sample[field] <= limit.max)) return false
  }
  return true
}

async function tick(sessionId) {
  if (inFlight.has(String(sessionId))) return inFlight.get(String(sessionId))
  const promise = (async () => {
    const session = await SimulationSession.findById(sessionId)
    if (!session || session.status !== 'running') return
    const body = await WaterBody.findOne({ _id: session.waterBodyId, userId: session.userId })
    if (!body) {
      session.status = 'interrupted'
      session.lastError = 'Water body is no longer available'
      session.stoppedAt = new Date()
      await session.save()
      clearInterval(timers.get(String(sessionId)))
      timers.delete(String(sessionId))
      return
    }
    const sample = sampleFor(session, body, session.samplesAttempted || 0)
    if (!sample) {
      session.status = 'interrupted'
      session.lastError = 'Supply seed values for unconfigured sensors and configure limits for the selected scenario'
      session.stoppedAt = new Date()
      await session.save()
      clearInterval(timers.get(String(sessionId)))
      timers.delete(String(sessionId))
      return
    }
    const sampleValidation = validateTelemetry(sample)
    if ((sampleValidation.errors.length && session.scenario !== 'invalid') ||
      !matchesConfiguredLimits(session, body, sample, session.samplesAttempted || 0)) {
      session.status = 'interrupted'
      session.lastError = 'Generated sample no longer matches accepted sensor or configured limit ranges'
      session.stoppedAt = new Date()
      await session.save()
      clearInterval(timers.get(String(sessionId)))
      timers.delete(String(sessionId))
      return
    }
    session.samplesAttempted += 1
    const result = await ingestTelemetry({
      body: sample,
      device: { deviceId: session.deviceId },
      dataSource: 'simulation',
      simulationSessionId: session._id,
      userId: session.userId,
      waterBody: body
    })
    if (result.ok) session.samplesGenerated += 1
    else if (session.scenario !== 'invalid' || result.status !== 400) {
      session.status = 'interrupted'
      session.lastError = 'Sample could not be stored'
      session.stoppedAt = new Date()
    }

    if (session.samplesAttempted >= session.sampleCount || session.status === 'stopping') {
      session.status = session.status === 'stopping' ? 'stopped' : 'completed'
      session.stoppedAt = new Date()
    }
    await session.save()
    if (session.status !== 'running') {
      clearInterval(timers.get(String(sessionId)))
      timers.delete(String(sessionId))
    }
  })().finally(() => inFlight.delete(String(sessionId)))
  inFlight.set(String(sessionId), promise)
  return promise
}

function startWorker(session) {
  const id = String(session._id)
  if (timers.has(id)) return
  const timer = setInterval(() => { tick(id).catch(() => {}) }, session.intervalMs)
  timers.set(id, timer)
}

async function startSimulation({ userId, waterBodyId, scenario, intervalMs, sampleCount, seedValues }) {
  if (process.env.NODE_ENV === 'production' && process.env.HYDROGEN_ENABLE_SIMULATION !== 'true') {
    return { status: 404, message: 'Simulation is not available in this environment' }
  }
  if (scenario === 'recovery' && sampleCount < 2) return { status: 400, message: 'Recovery scenarios require at least two samples' }
  const waterBody = await WaterBody.findOne({ _id: waterBodyId, userId })
  if (!waterBody) return { status: 404, message: 'Water body not found' }
  const device = await Device.findOne({ waterBodyId: waterBody._id }).select('deviceId')
  if (!device) return { status: 400, message: 'Register a Glob device for this water body before starting a simulation' }
  if (!baselineFor(waterBody, seedValues)) return { status: 400, message: 'Provide finite seed values for sensors without configured limits' }
  if (['above', 'below', 'recovery'].includes(scenario) && !fields.some((field) => waterBody.monitoringLimits?.[field]?.enabled)) {
    return { status: 400, message: 'Configure at least one monitoring limit for this scenario' }
  }
  const scenarioSession = { _id: 'preflight', scenario, sampleCount, samplesAttempted: 0, seedValues }
  const initialSample = sampleFor(scenarioSession, waterBody, 0)
  const initialValidation = validateTelemetry(initialSample || {})
  if (initialValidation.errors.length && scenario !== 'invalid') {
    return { status: 400, message: 'The configured limits produce a value outside accepted sensor ranges; adjust the limits or choose another scenario' }
  }
  if (!matchesConfiguredLimits(scenarioSession, waterBody, initialSample, 0)) {
    return { status: 400, message: 'The configured limits cannot produce the selected scenario; adjust the limits or choose another scenario' }
  }
  if (scenario === 'recovery') {
    const recoverySample = sampleFor({ ...scenarioSession, samplesAttempted: Math.ceil(sampleCount / 2) }, waterBody, Math.ceil(sampleCount / 2))
    const recoveryIndex = Math.ceil(sampleCount / 2)
    if (validateTelemetry(recoverySample || {}).errors.length ||
      !matchesConfiguredLimits(scenarioSession, waterBody, recoverySample, recoveryIndex)) {
      return { status: 400, message: 'Recovery sample would be outside accepted sensor or configured limit ranges' }
    }
  }
  const session = await SimulationSession.create({ userId, waterBodyId: waterBody._id, deviceId: device.deviceId, scenario, intervalMs, sampleCount, seedValues })
  startWorker(session)
  return { session }
}

async function stopSimulation(session) {
  const id = String(session._id)
  session.status = 'stopping'
  await session.save()
  await inFlight.get(id)
  clearInterval(timers.get(id))
  timers.delete(id)
  const latest = await SimulationSession.findOne({ _id: session._id, userId: session.userId })
  if (latest && latest.status !== 'completed') {
    latest.status = 'stopped'
    latest.stoppedAt = new Date()
    await latest.save()
  }
  return latest || session
}

async function deleteSimulation(session) {
  await stopSimulation(session)
  const id = session._id
  const filter = { userId: session.userId, simulationSessionId: id, dataSource: 'simulation' }
  if (mongoose.connection.readyState === 1) {
    const mongoSession = await mongoose.startSession()
    try {
      await mongoSession.withTransaction(async () => {
        await Reading.deleteMany(filter, { session: mongoSession })
        await Alert.deleteMany(filter, { session: mongoSession })
        await AlertEvaluationState.deleteMany({ userId: session.userId, simulationSessionId: id }, { session: mongoSession })
        await SimulationSession.deleteOne({ _id: id, userId: session.userId }, { session: mongoSession })
      })
    } finally { await mongoSession.endSession() }
  } else {
    await Reading.deleteMany(filter)
    await Alert.deleteMany(filter)
    await AlertEvaluationState.deleteMany({ userId: session.userId, simulationSessionId: id })
    await SimulationSession.deleteOne({ _id: id, userId: session.userId })
  }
}

async function interruptRunningSessions() {
  const running = await SimulationSession.find({ status: { $in: ['running', 'stopping'] } })
  for (const session of running) {
    session.status = 'interrupted'
    session.stoppedAt = new Date()
    session.lastError = 'Server restarted; simulation was not resumed'
    await session.save()
  }
}

module.exports = { startSimulation, stopSimulation, deleteSimulation, interruptRunningSessions, generateSample: sampleFor }
