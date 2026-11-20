const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const express = require('express')
const http = require('node:http')
const cookieParser = require('cookie-parser')
const jwt = require('jsonwebtoken')
const WaterBody = require('../models/WaterBody')
const Reading = require('../models/Reading')
const readingRoutes = require('../routes/readingRoutes')

const WATER_BODY_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const USER_ID = 'user-1'
const JWT_SECRET = 'reading-route-test-secret'
process.env.JWT_SECRET = JWT_SECRET

function makeReading(day, extra = {}) {
  return {
    _id: `reading-${day}`,
    deviceId: 'glob-1',
    waterBodyId: WATER_BODY_ID,
    temperature: 20 + day,
    pH: 7,
    salinity: 0.2,
    ammonia: 0.1,
    recordedAt: new Date(`2025-01-${String(day).padStart(2, '0')}T12:00:00.000Z`),
    ...extra
  }
}

function mockDatabase(t, { waterBody = { _id: WATER_BODY_ID }, records = [], failFind = false } = {}) {
  let waterBodyQuery
  let readingFilter
  let sortOrder
  let skipped
  let requestedLimit
  let selectedFields

  t.mock.method(WaterBody, 'findOne', (query) => {
    waterBodyQuery = query
    return {
      select: async () => waterBody
    }
  })
  t.mock.method(Reading, 'find', (filter) => {
    readingFilter = filter
    const query = {
      select(fields) { selectedFields = fields; return this },
      sort(order) { sortOrder = order; return this },
      skip(count) { skipped = count; return this },
      limit(count) { requestedLimit = count; return this },
      lean() {
        if (failFind) return Promise.reject(new Error('database internals'))
        const range = readingFilter.recordedAt || {}
        const matches = records.filter((reading) => {
          const timestamp = new Date(reading.recordedAt).getTime()
          return reading.waterBodyId === readingFilter.waterBodyId &&
            (!range.$gte || timestamp >= range.$gte.getTime()) &&
            (!range.$lte || timestamp <= range.$lte.getTime())
        })
        matches.sort((a, b) => b.recordedAt - a.recordedAt)
        return Promise.resolve(matches.slice(skipped, skipped + requestedLimit))
      }
    }
    return query
  })
  t.mock.method(Reading, 'countDocuments', async (filter) => {
    const range = filter.recordedAt || {}
    return records.filter((reading) => {
      const timestamp = new Date(reading.recordedAt).getTime()
      return reading.waterBodyId === filter.waterBodyId &&
        (!range.$gte || timestamp >= range.$gte.getTime()) &&
        (!range.$lte || timestamp <= range.$lte.getTime())
    }).length
  })

  return () => ({ waterBodyQuery, readingFilter, sortOrder, skipped, requestedLimit, selectedFields })
}

async function startServer(t) {
  const app = express()
  app.use(cookieParser())
  app.use('/api/readings', readingRoutes)
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  return `http://127.0.0.1:${server.address().port}`
}

function getJson(baseUrl, query, authenticated = true) {
  const token = jwt.sign({ userId: USER_ID }, JWT_SECRET)
  const url = `${baseUrl}/api/readings${query ? `?${query}` : ''}`
  return new Promise((resolve, reject) => {
    const request = http.get(url, {
      headers: authenticated ? { cookie: `token=${token}` } : {}
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }))
    })
    request.on('error', reject)
  })
}

test('authenticated user retrieves own water body readings with pagination metadata', async (t) => {
  const inspect = mockDatabase(t, { records: [makeReading(1), makeReading(2)] })
  const baseUrl = await startServer(t)
  const response = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}`)

  assert.equal(response.status, 200)
  assert.equal(response.body.success, true)
  assert.equal(response.body.page, 1)
  assert.equal(response.body.pageSize, 20)
  assert.equal(response.body.total, 2)
  assert.equal(response.body.totalPages, 1)
  assert.deepEqual(inspect().waterBodyQuery, { _id: WATER_BODY_ID, userId: USER_ID })
  assert.deepEqual(inspect().readingFilter, { waterBodyId: WATER_BODY_ID })
  assert.equal(inspect().selectedFields, 'deviceId waterBodyId ammonia temperature salinity pH recordedAt dataSource simulationSessionId')
})

test('real source filter includes legacy readings without source metadata', async (t) => {
  const inspect = mockDatabase(t, { records: [makeReading(1)] })
  const baseUrl = await startServer(t)
  const response = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&dataSource=real`)

  assert.equal(response.status, 200)
  assert.deepEqual(inspect().readingFilter, {
    waterBodyId: WATER_BODY_ID,
    $or: [{ dataSource: 'real' }, { dataSource: { $exists: false } }]
  })
})

test('user cannot retrieve readings for a water body they do not own', async (t) => {
  const inspect = mockDatabase(t, { waterBody: null, records: [makeReading(1)] })
  const findReadings = t.mock.method(Reading, 'find', () => { throw new Error('must not query readings') })
  const baseUrl = await startServer(t)
  const response = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}`)

  assert.equal(response.status, 404)
  assert.deepEqual(response.body, { success: false, message: 'Water body not found' })
  assert.deepEqual(inspect().waterBodyQuery, { _id: WATER_BODY_ID, userId: USER_ID })
  assert.equal(findReadings.mock.callCount(), 0)
})

test('missing and malformed waterBodyId are rejected', async (t) => {
  mockDatabase(t)
  const baseUrl = await startServer(t)
  const missing = await getJson(baseUrl, '')
  const invalid = await getJson(baseUrl, 'waterBodyId=not-an-object-id')

  assert.equal(missing.status, 400)
  assert.equal(invalid.status, 400)
})

test('invalid date values and reversed date range are rejected', async (t) => {
  mockDatabase(t)
  const baseUrl = await startServer(t)
  const invalidFrom = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&from=2025-02-30`)
  const invalidTo = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&to=yesterday`)
  const reversed = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&from=2025-02-02&to=2025-02-01`)

  assert.equal(invalidFrom.status, 400)
  assert.equal(invalidTo.status, 400)
  assert.equal(reversed.status, 400)
})

test('date range filters inclusively and readings are sorted newest first', async (t) => {
  const inspect = mockDatabase(t, {
    records: [makeReading(1), makeReading(2), makeReading(3), makeReading(4)]
  })
  const baseUrl = await startServer(t)
  const response = await getJson(baseUrl,
    `waterBodyId=${WATER_BODY_ID}&from=2025-01-02T12%3A00%3A00.000Z&to=2025-01-03T12%3A00%3A00.000Z`)

  assert.equal(response.status, 200)
  assert.deepEqual(response.body.readings.map((reading) => reading._id), ['reading-3', 'reading-2'])
  assert.deepEqual(inspect().readingFilter.recordedAt, {
    $gte: new Date('2025-01-02T12:00:00.000Z'),
    $lte: new Date('2025-01-03T12:00:00.000Z')
  })
  assert.deepEqual(inspect().sortOrder, { recordedAt: -1 })
})

test('pagination returns requested page and uses the requested offset and size', async (t) => {
  const inspect = mockDatabase(t, { records: [makeReading(1), makeReading(2), makeReading(3), makeReading(4)] })
  const baseUrl = await startServer(t)
  const response = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&page=2&limit=2`)

  assert.equal(response.status, 200)
  assert.deepEqual(response.body.readings.map((reading) => reading._id), ['reading-2', 'reading-1'])
  assert.equal(response.body.page, 2)
  assert.equal(response.body.pageSize, 2)
  assert.equal(response.body.total, 4)
  assert.equal(response.body.totalPages, 2)
  assert.equal(inspect().skipped, 2)
  assert.equal(inspect().requestedLimit, 2)
})

test('maximum page size of 100 is accepted and limits above it are rejected', async (t) => {
  const inspect = mockDatabase(t)
  const baseUrl = await startServer(t)
  const allowed = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&limit=100`)
  const rejected = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&limit=101`)

  assert.equal(allowed.status, 200)
  assert.equal(inspect().requestedLimit, 100)
  assert.equal(rejected.status, 400)
})

test('invalid page and limit values are rejected', async (t) => {
  mockDatabase(t)
  const baseUrl = await startServer(t)
  const invalidPage = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&page=1.5`)
  const zeroPage = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&page=0`)
  const invalidLimit = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&limit=20.0`)
  const zeroLimit = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}&limit=0`)

  assert.equal(invalidPage.status, 400)
  assert.equal(zeroPage.status, 400)
  assert.equal(invalidLimit.status, 400)
  assert.equal(zeroLimit.status, 400)
})

test('empty result returns an empty readings array and zero totals', async (t) => {
  mockDatabase(t)
  const baseUrl = await startServer(t)
  const response = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}`)

  assert.equal(response.status, 200)
  assert.deepEqual(response.body.readings, [])
  assert.equal(response.body.total, 0)
  assert.equal(response.body.totalPages, 0)
})

test('unauthenticated request is rejected before water body lookup', async (t) => {
  const inspect = mockDatabase(t)
  const baseUrl = await startServer(t)
  const response = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}`, false)

  assert.equal(response.status, 401)
  assert.deepEqual(inspect().waterBodyQuery, undefined)
})

test('database failures return generic 500 without database details', async (t) => {
  mockDatabase(t, { records: [makeReading(1)], failFind: true })
  const baseUrl = await startServer(t)
  const response = await getJson(baseUrl, `waterBodyId=${WATER_BODY_ID}`)

  assert.equal(response.status, 500)
  assert.deepEqual(response.body, { success: false, message: 'Could not retrieve readings' })
  assert.equal(JSON.stringify(response.body).includes('database internals'), false)
})
