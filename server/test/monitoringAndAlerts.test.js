const test = require('node:test')
const assert = require('node:assert/strict')
const WaterBody = require('../models/WaterBody')
const Alert = require('../models/Alert')
const { validateMonitoringLimits } = require('../services/monitoringLimits')
const { getAlerts } = require('../controllers/alertController')

test('monitoring limits require finite complete ranges and enforce telemetry domains', () => {
  const good = validateMonitoringLimits({ temperature: { enabled: true, min: -20, max: 80 }, pH: { enabled: true, min: 2, max: 12 } })
  assert.deepEqual(good.errors, [])
  assert.equal(good.value.temperature.min, -20)

  for (const input of [
    { pH: { enabled: true, min: 0, max: 15 } },
    { ammonia: { enabled: true, min: -1, max: 2 } },
    { salinity: { enabled: true, min: 0 } },
    { temperature: { enabled: true, min: 4, max: 4 } },
    { ammonia: { enabled: true, min: 0, max: Infinity } }
  ]) assert.ok(validateMonitoringLimits(input).errors.length > 0)
})

test('alerts retrieval limits results to authenticated user water bodies and returns source metadata', async (t) => {
  const ownBodyId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
  let alertFilter
  t.mock.method(WaterBody, 'find', () => ({ select: async () => [{ _id: ownBodyId }] }))
  t.mock.method(Alert, 'find', (filter) => {
    alertFilter = filter
    return {
      populate() { return this }, sort() { return this }, skip() { return this }, limit() { return this },
      lean: async () => [{ _id: 'alert-1', waterBodyId: { _id: ownBodyId, name: 'Pond' }, parameter: 'pH', value: 8, threshold: 7, createdAt: new Date('2026-01-01T00:00:00Z') }]
    }
  })
  t.mock.method(Alert, 'countDocuments', async () => 1)
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this }, json(body) { this.body = body; return this } }
  await getAlerts({ userId: 'user-private', query: {} }, response)

  assert.equal(response.statusCode, 200)
  assert.deepEqual(alertFilter.waterBodyId, { $in: [ownBodyId] })
  assert.equal(alertFilter.$or[0].userId, 'user-private')
  assert.equal(response.body.alerts[0].observedValue, 8)
  assert.equal(response.body.alerts[0].dataSource, 'real')
  assert.equal(response.body.alerts[0].waterBodyId.name, 'Pond')
})
