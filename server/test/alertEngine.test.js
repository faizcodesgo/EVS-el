const test = require('node:test')
const assert = require('node:assert/strict')
const Reading = require('../models/Reading')
const Alert = require('../models/Alert')
const AlertEvaluationState = require('../models/AlertEvaluationState')
const { ingestTelemetry } = require('../services/telemetryIngestion')

test('alert engine creates, updates, resolves and reopens alerts through telemetry ingestion', async (t) => {
  const states = new Map()
  const alerts = new Map()
  const stateKey = (filter) => `${filter.waterBodyId}:${filter.parameter}:${filter.dataSource}:${filter.simulationSessionId || ''}`
  t.mock.method(Reading, 'create', async (reading) => ({ ...reading, _id: 'reading-id' }))
  t.mock.method(AlertEvaluationState, 'findOne', async (filter) => states.get(stateKey(filter)) || null)
  t.mock.method(AlertEvaluationState, 'updateOne', async (filter, update) => {
    const state = [...states.values()].find((entry) => String(entry._id) === String(filter._id))
    if (!state || state.lastEvaluatedAt?.getTime() !== filter.lastEvaluatedAt?.getTime()) return { modifiedCount: 0 }
    state.lastEvaluatedAt = update.$set.lastEvaluatedAt
    return { modifiedCount: 1 }
  })
  t.mock.method(AlertEvaluationState.prototype, 'save', async function save() {
    this._id ||= `state:${this.parameter}`
    states.set(stateKey(this), this)
    return this
  })
  t.mock.method(Alert, 'findOne', async () => null)
  t.mock.method(Alert, 'findById', async (id) => alerts.get(String(id)) || null)
  t.mock.method(Alert, 'updateOne', async (filter, update) => {
    const alert = alerts.get(String(filter._id))
    if (alert) Object.assign(alert, update.$set)
    return { modifiedCount: alert ? 1 : 0 }
  })
  t.mock.method(Alert.prototype, 'save', async function save() {
    this._id ||= `alert:${alerts.size + 1}`
    alerts.set(String(this._id), this)
    return this
  })

  const waterBody = {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    userId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    monitoringLimitsVersion: 1,
    monitoringLimits: { pH: { enabled: true, min: 6, max: 8 } }
  }
  const send = (pH) => ingestTelemetry({
    body: { temperature: 20, pH, salinity: 1, ammonia: 0.1 },
    device: { deviceId: 'glob-1' },
    waterBody,
    dataSource: 'real'
  })

  assert.equal((await send(5)).ok, true)
  let history = [...alerts.values()]
  assert.equal(history.length, 1)
  assert.equal(history[0].status, 'active')
  assert.equal(history[0].violationDirection, 'below_minimum')
  await new Promise((resolve) => setTimeout(resolve, 2))

  await send(5.5)
  assert.equal(history[0].observedValue, 5.5)
  const lastObserved = history[0].lastObservedAt
  await new Promise((resolve) => setTimeout(resolve, 2))

  await send(7)
  assert.equal(history[0].status, 'resolved')
  assert.ok(history[0].resolvedAt)
  assert.ok(history[0].lastObservedAt >= lastObserved)
  await new Promise((resolve) => setTimeout(resolve, 2))

  await send(5)
  history = [...alerts.values()]
  assert.equal(history.length, 2)
  assert.equal(history[1].status, 'active')
  await new Promise((resolve) => setTimeout(resolve, 2))
  await send(9)
  history = [...alerts.values()]
  assert.equal(history.length, 3)
  assert.equal(history[1].status, 'resolved')
  assert.equal(history[1].resolutionReason, 'violation_changed')
  assert.equal(history[2].status, 'active')
  assert.equal(history[2].violationDirection, 'above_maximum')
})
