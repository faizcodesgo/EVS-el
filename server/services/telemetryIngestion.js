const mongoose = require('mongoose')
const Reading = require('../models/Reading')
const Alert = require('../models/Alert')
const AlertEvaluationState = require('../models/AlertEvaluationState')
const WaterBody = require('../models/WaterBody')
const { PARAMETER_KEYS } = require('./monitoringLimits')

const sensorFields = ['temperature', 'pH', 'salinity', 'ammonia']

function validateTelemetry(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { errors: sensorFields.map((field) => ({ field, message: 'is required' })) }
  }
  const errors = []
  for (const field of sensorFields) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) errors.push({ field, message: 'is required' })
    else if (typeof body[field] !== 'number' || !Number.isFinite(body[field])) {
      errors.push({ field, message: 'must be a finite number' })
    }
  }
  for (const field of ['ammonia', 'salinity']) {
    if (typeof body[field] === 'number' && Number.isFinite(body[field]) && body[field] < 0) {
      errors.push({ field, message: 'must be zero or greater' })
    }
  }
  if (typeof body.pH === 'number' && Number.isFinite(body.pH) && (body.pH < 0 || body.pH > 14)) {
    errors.push({ field: 'pH', message: 'must be between 0 and 14' })
  }
  return { errors }
}

function withSession(query, session) {
  return session ? query.session(session) : query
}

function scopeFor(context, parameter) {
  return {
    userId: context.userId,
    waterBodyId: context.waterBody._id,
    parameter,
    dataSource: context.dataSource,
    simulationSessionId: context.simulationSessionId || null
  }
}

async function findAlertById(id, session) {
  if (!id) return null
  return withSession(Alert.findById(id), session)
}

async function reserveEvaluation(scope, recordedAt, session) {
  let state = await withSession(AlertEvaluationState.findOne(scope), session)
  if (!state) {
    state = new AlertEvaluationState({ ...scope, lastEvaluatedAt: recordedAt, activeAlertId: null })
    await state.save(session ? { session } : undefined)
    return state
  }

  if (state.lastEvaluatedAt && state.lastEvaluatedAt.getTime() > recordedAt.getTime()) return null
  const condition = {
    _id: state._id,
    lastEvaluatedAt: state.lastEvaluatedAt || null
  }
  const result = await AlertEvaluationState.updateOne(
    condition,
    { $set: { lastEvaluatedAt: recordedAt }, $inc: { evaluationVersion: 1 } },
    session ? { session } : {}
  )
  if (result.modifiedCount !== 1) {
    const error = new Error('Alert evaluation state changed concurrently')
    error.code = 'HYDROGEN_EVALUATION_RETRY'
    throw error
  }
  state.lastEvaluatedAt = recordedAt
  return state
}

function getViolation(value, limit) {
  if (!limit?.enabled || !Number.isFinite(limit.min) || !Number.isFinite(limit.max)) return null
  if (value < limit.min) return { direction: 'below_minimum', threshold: limit.min }
  if (value > limit.max) return { direction: 'above_maximum', threshold: limit.max }
  return null
}

async function resolveAlert(alert, state, session, reason, recordedAt, scope) {
  if (alert) {
    await Alert.updateOne(
      { _id: alert._id, waterBodyId: scope.waterBodyId },
      { $set: {
        status: 'resolved', resolvedAt: recordedAt, resolutionReason: reason,
        lastObservedAt: recordedAt, userId: scope.userId, dataSource: scope.dataSource
      } },
      session ? { session } : {}
    )
  }
  state.activeAlertId = null
  await state.save(session ? { session } : undefined)
}

async function evaluateParameter(reading, context, parameter, session) {
  const scope = scopeFor(context, parameter)
  const limit = context.waterBody.monitoringLimits?.[parameter]
  const state = await reserveEvaluation(scope, reading.recordedAt, session)
  if (!state) return

  let activeAlert = await findAlertById(state.activeAlertId, session)
  if (!activeAlert) {
    activeAlert = await withSession(Alert.findOne({ ...scope, status: 'active' }), session)
  }
  if (!activeAlert && context.dataSource === 'real') {
    activeAlert = await withSession(Alert.findOne({
      waterBodyId: context.waterBody._id,
      parameter,
      status: 'active',
      $and: [
        { $or: [{ userId: { $exists: false } }, { userId: null }] },
        { $or: [{ dataSource: { $exists: false } }, { dataSource: 'real' }] }
      ]
    }), session)
  }

  const limitsVersion = context.waterBody.monitoringLimitsVersion || 0
  const limitChanged = activeAlert && activeAlert.monitoringLimitsVersion !== limitsVersion
  if (activeAlert && limitChanged) {
    await resolveAlert(
      activeAlert,
      state,
      session,
      limit?.enabled ? 'limits_changed' : 'monitoring_disabled',
      reading.recordedAt,
      scope
    )
    activeAlert = null
  }

  const violation = getViolation(reading[parameter], limit)
  if (activeAlert && violation && activeAlert.violationDirection &&
      activeAlert.violationDirection !== 'unknown' && activeAlert.violationDirection !== violation.direction) {
    await resolveAlert(activeAlert, state, session, 'violation_changed', reading.recordedAt, scope)
    activeAlert = null
  }
  if (!limit?.enabled || !Number.isFinite(limit.min) || !Number.isFinite(limit.max)) {
    if (activeAlert) await resolveAlert(activeAlert, state, session, 'monitoring_disabled', reading.recordedAt, scope)
    else if (state.activeAlertId) {
      state.activeAlertId = null
      await state.save(session ? { session } : undefined)
    }
    return
  }

  if (!violation) {
    if (activeAlert) await resolveAlert(activeAlert, state, session, 'within_range', reading.recordedAt, scope)
    else if (state.activeAlertId) {
      state.activeAlertId = null
      await state.save(session ? { session } : undefined)
    }
    return
  }

  if (activeAlert) {
    await Alert.updateOne(
      { _id: activeAlert._id, waterBodyId: context.waterBody._id },
      { $set: {
        userId: scope.userId,
        deviceId: reading.deviceId,
        observedValue: reading[parameter],
        value: reading[parameter],
        threshold: violation.threshold,
        message: `${parameter} is ${violation.direction === 'below_minimum' ? 'below the configured minimum' : 'above the configured maximum'}`,
        thresholdSnapshot: { min: limit.min, max: limit.max },
        violationDirection: violation.direction,
        triggeredAt: activeAlert.triggeredAt || activeAlert.createdAt || reading.recordedAt,
        lastObservedAt: reading.recordedAt,
        dataSource: context.dataSource,
        simulationSessionId: context.simulationSessionId || null,
        monitoringLimitsVersion: limitsVersion
      } },
      session ? { session } : {}
    )
    state.activeAlertId = activeAlert._id
    await state.save(session ? { session } : undefined)
    return
  }

  const snapshot = { min: limit.min, max: limit.max }
  const threshold = violation.threshold
  const alert = new Alert({
    ...scope,
    deviceId: reading.deviceId,
    observedValue: reading[parameter],
    thresholdSnapshot: snapshot,
    violationDirection: violation.direction,
    triggeredAt: reading.recordedAt,
    lastObservedAt: reading.recordedAt,
    status: 'active',
    dataSource: context.dataSource,
    simulationSessionId: context.simulationSessionId || null,
    monitoringLimitsVersion: limitsVersion,
    value: reading[parameter],
    threshold,
    message: `${parameter} is ${violation.direction === 'below_minimum' ? 'below the configured minimum' : 'above the configured maximum'}`
  })
  await alert.save(session ? { session } : undefined)
  state.activeAlertId = alert._id
  await state.save(session ? { session } : undefined)
}

async function evaluateAlerts(reading, context, session) {
  for (const parameter of PARAMETER_KEYS) {
    await evaluateParameter(reading, context, parameter, session)
  }
}

async function persistAndEvaluate(body, context, recordedAt, session) {
  const document = {
    deviceId: context.device.deviceId,
    waterBodyId: context.waterBody._id,
    temperature: body.temperature,
    pH: body.pH,
    salinity: body.salinity,
    ammonia: body.ammonia,
    recordedAt,
    dataSource: context.dataSource,
    simulationSessionId: context.simulationSessionId || null,
    userId: context.dataSource === 'simulation' ? context.userId : undefined
  }

  let reading
  if (session) [reading] = await Reading.create([document], { session })
  else reading = await Reading.create(document)
  await evaluateAlerts(reading, context, session)
  return reading
}

async function executeAtomic(body, context, recordedAt) {
  if (mongoose.connection.readyState !== 1) return persistAndEvaluate(body, context, recordedAt, null)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await mongoose.startSession()
    try {
      let reading
      await session.withTransaction(async () => {
        reading = await persistAndEvaluate(body, context, recordedAt, session)
      })
      return reading
    } catch (error) {
      const retryable = error.code === 11000 || error.code === 'HYDROGEN_EVALUATION_RETRY' ||
        error.hasErrorLabel?.('TransientTransactionError') || error.hasErrorLabel?.('UnknownTransactionCommitResult')
      if (!retryable || attempt === 2) throw error
    } finally {
      await session.endSession()
    }
  }
}

async function ingestTelemetry({ body, device, dataSource = 'real', simulationSessionId = null, userId = null, waterBody = null }) {
  const validation = validateTelemetry(body)
  if (validation.errors.length) return { ok: false, validationErrors: validation.errors }

  let assignedWaterBody = waterBody
  if (!assignedWaterBody) {
    const query = WaterBody.findById(device.waterBodyId).select('userId monitoringLimits monitoringLimitsVersion')
    assignedWaterBody = await query
  }
  if (!assignedWaterBody) return { ok: false, status: 404, message: 'Assigned water body not found' }

  const ownerId = userId || assignedWaterBody.userId
  if (!ownerId) return { ok: false, status: 500, message: 'Could not resolve telemetry ownership' }
  const context = {
    device,
    waterBody: assignedWaterBody,
    userId: ownerId,
    dataSource,
    simulationSessionId
  }

  const recordedAt = new Date()
  try {
    const reading = await executeAtomic(body, context, recordedAt)
    return { ok: true, reading }
  } catch (error) {
    console.error('Sensor telemetry persistence or alert evaluation failed')
    return { ok: false, status: 500, message: 'Could not save sensor telemetry' }
  }
}

module.exports = { ingestTelemetry, validateTelemetry }
