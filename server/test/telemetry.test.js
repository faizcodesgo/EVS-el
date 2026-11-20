const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const express = require('express')
const http = require('node:http')
const Device = require('../models/Device')
const Reading = require('../models/Reading')
const WaterBody = require('../models/WaterBody')
const Alert = require('../models/Alert')
const AlertEvaluationState = require('../models/AlertEvaluationState')
const deviceIngressRoutes = require('../routes/deviceIngressRoutes')
const receiveTelemetry = require('../controllers/telemetryController')

function makeDevice(credential = 'telemetry-secret') {
  return {
    deviceId: 'glob-assigned',
    waterBodyId: 'body-assigned',
    credentialHash: crypto.createHash('sha256').update(credential).digest('hex'),
    save: async function save() {}
  }
}

async function startTestServer(t) {
  const app = express()
  app.use(express.json())
  app.use('/api/device', deviceIngressRoutes)
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}

async function postJson(baseUrl, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body)
    const request = http.request(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...headers
      }
    }, (response) => {
      let responseBody = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { responseBody += chunk })
      response.on('end', () => resolve({
        status: response.statusCode,
        body: responseBody ? JSON.parse(responseBody) : null,
        raw: responseBody
      }))
    })
    request.on('error', reject)
    if (payload) request.write(payload)
    request.end()
  })
}

function responseRecorder() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this },
    json(body) { this.body = body; return this }
  }
}

function mockAlertEvaluation(t) {
  t.mock.method(AlertEvaluationState, 'findOne', async () => null)
  t.mock.method(AlertEvaluationState.prototype, 'save', async function save() { this._id = this._id || 'state-id'; return this })
  t.mock.method(Alert, 'findOne', async () => null)
}

function mockWaterBody(t, id = 'aaaaaaaaaaaaaaaaaaaaaaaa') {
  t.mock.method(WaterBody, 'findById', () => ({ select: async () => ({ _id: id, userId: 'bbbbbbbbbbbbbbbbbbbbbbbb' }) }))
}

test('authenticated telemetry is saved with authenticated identity, sensor values and server time', async (t) => {
  const credential = 'telemetry-secret'
  const device = makeDevice(credential)
  let savedReading
  t.mock.method(Device, 'findOne', () => ({ select: async () => device }))
  t.mock.method(Reading, 'create', async (document) => {
    savedReading = document
    return document
  })
  mockWaterBody(t, device.waterBodyId)
  mockAlertEvaluation(t)
  const baseUrl = await startTestServer(t)

  const beforeRequest = Date.now()
  const response = await postJson(baseUrl, '/api/device/telemetry', {
    temperature: 23.5,
    pH: 7.2,
    salinity: 0.4,
    ammonia: 0.08,
    deviceId: 'spoofed-device',
    waterBodyId: 'spoofed-body',
    recordedAt: '2000-01-01T00:00:00.000Z'
  }, { 'x-device-id': device.deviceId, 'x-device-key': credential })
  const afterRequest = Date.now()

  assert.equal(response.status, 201)
  assert.equal(response.body.success, true)
  assert.equal(response.body.deviceId, 'glob-assigned')
  assert.equal(response.body.waterBodyId, 'body-assigned')
  assert.deepEqual(savedReading, {
    deviceId: 'glob-assigned',
    waterBodyId: 'body-assigned',
    temperature: 23.5,
    pH: 7.2,
    salinity: 0.4,
    ammonia: 0.08,
    recordedAt: savedReading.recordedAt,
    dataSource: 'real',
    simulationSessionId: null,
    userId: undefined
  })
  assert.ok(savedReading.recordedAt instanceof Date)
  assert.ok(savedReading.recordedAt.getTime() >= beforeRequest)
  assert.ok(savedReading.recordedAt.getTime() <= afterRequest)
  assert.notEqual(savedReading.recordedAt.toISOString(), '2000-01-01T00:00:00.000Z')
  assert.deepEqual(response.body.telemetry, {
    temperature: 23.5,
    pH: 7.2,
    salinity: 0.4,
    ammonia: 0.08
  })
  assert.equal(response.raw.includes(credential), false)
  assert.equal(response.raw.includes(device.credentialHash), false)
  assert.equal(response.raw.includes('spoofed'), false)
})

test('telemetry endpoint rejects missing and incorrect device credentials', async (t) => {
  const device = makeDevice()
  t.mock.method(Device, 'findOne', () => ({ select: async () => device }))
  const createReading = t.mock.method(Reading, 'create', async (document) => document)
  const baseUrl = await startTestServer(t)
  const payload = { temperature: 20, pH: 7, salinity: 0, ammonia: 0 }

  const missing = await postJson(baseUrl, '/api/device/telemetry', payload)
  const incorrect = await postJson(baseUrl, '/api/device/telemetry', payload, {
    'x-device-id': device.deviceId,
    'x-device-key': 'wrong-secret'
  })

  assert.equal(missing.status, 401)
  assert.equal(incorrect.status, 401)
  assert.equal(createReading.mock.callCount(), 0)
})

test('telemetry validation rejects missing, non-numeric, non-finite and out-of-range values without saving', async (t) => {
  const createReading = t.mock.method(Reading, 'create', async (document) => document)
  const device = { deviceId: 'trusted-device', waterBodyId: 'trusted-body' }
  const base = { temperature: 20, pH: 7, salinity: 0, ammonia: 0 }
  const missingTemperature = Object.fromEntries(
    Object.entries(base).filter(([field]) => field !== 'temperature')
  )
  const invalidPayloads = [
    missingTemperature,
    { ...base, temperature: '20' },
    { ...base, temperature: NaN },
    { ...base, temperature: Infinity },
    { ...base, ammonia: -0.1 },
    { ...base, salinity: -0.1 },
    { ...base, pH: -0.01 },
    { ...base, pH: 14.01 }
  ]

  for (const payload of invalidPayloads) {
    const res = responseRecorder()
    await receiveTelemetry({ body: payload, device }, res)
    assert.equal(res.statusCode, 400, JSON.stringify(payload))
    assert.equal(res.body.success, false)
    assert.ok(Array.isArray(res.body.errors))
  }
  assert.equal(createReading.mock.callCount(), 0)
})

test('telemetry persistence failure returns 500 instead of success', async (t) => {
  mockWaterBody(t)
  mockAlertEvaluation(t)
  t.mock.method(Reading, 'create', async () => {
    throw new Error('private database failure detail')
  })
  const res = responseRecorder()
  await receiveTelemetry({
    device: { deviceId: 'trusted-device', waterBodyId: 'trusted-body' },
    body: { temperature: 22, pH: 7, salinity: 0, ammonia: 0 }
  }, res)

  assert.equal(res.statusCode, 500)
  assert.equal(res.body.success, false)
  assert.equal(res.body.message, 'Could not save sensor telemetry')
  assert.equal(JSON.stringify(res.body).includes('private database failure detail'), false)
})

test('telemetry accepts boundary values and ignores unsupported extra fields', async (t) => {
  mockWaterBody(t)
  mockAlertEvaluation(t)
  t.mock.method(Reading, 'create', async (document) => document)
  const res = responseRecorder()
  await receiveTelemetry({
    device: { deviceId: 'trusted-device', waterBodyId: 'trusted-body' },
    body: { temperature: -500, pH: 14, salinity: 0, ammonia: 0, extra: 'ignored' }
  }, res)

  assert.equal(res.statusCode, 201)
  assert.equal(res.body.telemetry.temperature, -500)
  assert.equal(res.body.telemetry.pH, 14)
  assert.equal('extra' in res.body.telemetry, false)
})
