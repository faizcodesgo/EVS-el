const test = require('node:test')
const assert = require('node:assert/strict')
const SimulationSession = require('../models/SimulationSession')
const Reading = require('../models/Reading')
const Alert = require('../models/Alert')
const AlertEvaluationState = require('../models/AlertEvaluationState')
const { deleteSimulation, startSimulation } = require('../services/simulationService')
const { generateSample } = require('../services/simulationService')
const { validateTelemetry } = require('../services/telemetryIngestion')

const configuredBody = {
  monitoringLimits: {
    temperature: { enabled: true, min: 10, max: 30 },
    pH: { enabled: true, min: 6, max: 8 },
    salinity: { enabled: true, min: 2, max: 4 },
    ammonia: { enabled: true, min: 1, max: 3 }
  }
}
const seeds = { temperature: 20, pH: 7, salinity: 3, ammonia: 2 }

test('simulation readings vary deterministically from the session baseline', () => {
  const session = { _id: 'session-alpha', scenario: 'normal', sampleCount: 8, seedValues: seeds }
  const samples = Array.from({ length: 5 }, (_, index) => generateSample(session, configuredBody, index))
  for (const field of Object.keys(seeds)) {
    assert.equal(new Set(samples.map((sample) => sample[field])).size, samples.length, `${field} should vary every sample`)
    for (const sample of samples) assert.ok(sample[field] >= configuredBody.monitoringLimits[field].min && sample[field] <= configuredBody.monitoringLimits[field].max)
  }
  assert.deepEqual(samples, Array.from({ length: 5 }, (_, index) => generateSample(session, configuredBody, index)))
})

test('above, below, recovery and invalid scenarios have distinct validated patterns', () => {
  const makeSession = (scenario) => ({ _id: 'session-scenarios', scenario, sampleCount: 4, seedValues: seeds })
  const above = generateSample(makeSession('above'), configuredBody, 1)
  const below = generateSample(makeSession('below'), configuredBody, 1)
  const recoveryViolation = generateSample(makeSession('recovery'), configuredBody, 0)
  const recovered = generateSample(makeSession('recovery'), configuredBody, 2)
  const invalid = generateSample(makeSession('invalid'), configuredBody, 1)

  for (const field of Object.keys(seeds)) {
    assert.ok(above[field] > configuredBody.monitoringLimits[field].max)
    assert.ok(below[field] < configuredBody.monitoringLimits[field].min)
    assert.notEqual(above[field], generateSample(makeSession('above'), configuredBody, 2)[field])
    assert.ok(recovered[field] >= configuredBody.monitoringLimits[field].min && recovered[field] <= configuredBody.monitoringLimits[field].max)
  }
  assert.ok(recoveryViolation.pH < configuredBody.monitoringLimits.pH.min)
  assert.equal(validateTelemetry(recoveryViolation).errors.length, 0)
  assert.ok(validateTelemetry(invalid).errors.some((error) => error.field === 'pH'))
})

test('invalid simulation samples are rejected by shared ingestion without storage', async (t) => {
  const { ingestTelemetry } = require('../services/telemetryIngestion')
  const createReading = t.mock.method(Reading, 'create', async (reading) => reading)
  const invalidBody = generateSample({ _id: 'invalid-session', scenario: 'invalid', sampleCount: 3, seedValues: seeds }, configuredBody, 0)
  const result = await ingestTelemetry({
    body: invalidBody,
    device: { deviceId: 'glob-1' },
    dataSource: 'simulation',
    simulationSessionId: 'dddddddddddddddddddddddd',
    userId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    waterBody: { ...configuredBody, _id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }
  })
  assert.equal(result.ok, false)
  assert.ok(result.validationErrors.some((error) => error.field === 'pH'))
  assert.equal(createReading.mock.callCount(), 0)
})

test('unconfigured parameters fluctuate around seeds and session IDs produce independent sequences', () => {
  const body = { monitoringLimits: { pH: { enabled: true, min: 6, max: 8 } } }
  const first = { _id: 'session-alpha', scenario: 'normal', sampleCount: 5, seedValues: seeds }
  const second = { _id: 'session-beta', scenario: 'normal', sampleCount: 5, seedValues: seeds }
  const samples = Array.from({ length: 5 }, (_, index) => generateSample(first, body, index))
  for (const field of ['temperature', 'salinity', 'ammonia']) {
    assert.equal(new Set(samples.map((sample) => sample[field])).size, 5)
    assert.ok(samples.every((sample) => Number.isFinite(sample[field])))
  }
  assert.notDeepEqual(generateSample(first, body, 0), generateSample(second, body, 0))
})

test('simulation creation is disabled in production unless explicitly enabled', async () => {
  const original = process.env.NODE_ENV
  const enabled = process.env.HYDROGEN_ENABLE_SIMULATION
  process.env.NODE_ENV = 'production'
  delete process.env.HYDROGEN_ENABLE_SIMULATION
  try {
    const result = await startSimulation({})
    assert.equal(result.status, 404)
  } finally {
    if (original === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = original
    if (enabled === undefined) delete process.env.HYDROGEN_ENABLE_SIMULATION
    else process.env.HYDROGEN_ENABLE_SIMULATION = enabled
  }
})

test('simulation deletion scopes cleanup to that owner and simulation session', async (t) => {
  const session = {
    _id: 'cccccccccccccccccccccccc', userId: 'bbbbbbbbbbbbbbbbbbbbbbbb', status: 'running',
    async save() { return this }
  }
  const latest = { ...session, status: 'stopping', async save() { return this } }
  t.mock.method(SimulationSession, 'findOne', async () => latest)
  const readingDelete = t.mock.method(Reading, 'deleteMany', async () => ({ deletedCount: 2 }))
  const alertDelete = t.mock.method(Alert, 'deleteMany', async () => ({ deletedCount: 1 }))
  const stateDelete = t.mock.method(AlertEvaluationState, 'deleteMany', async () => ({ deletedCount: 4 }))
  const sessionDelete = t.mock.method(SimulationSession, 'deleteOne', async () => ({ deletedCount: 1 }))

  await deleteSimulation(session)
  const expected = { userId: session.userId, simulationSessionId: session._id, dataSource: 'simulation' }
  assert.deepEqual(readingDelete.mock.calls[0].arguments[0], expected)
  assert.deepEqual(alertDelete.mock.calls[0].arguments[0], expected)
  assert.deepEqual(stateDelete.mock.calls[0].arguments[0], { userId: session.userId, simulationSessionId: session._id })
  assert.deepEqual(sessionDelete.mock.calls[0].arguments[0], { _id: session._id, userId: session.userId })
})
