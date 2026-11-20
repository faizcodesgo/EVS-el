const WaterBody = require('../models/WaterBody')
const Reading = require('../models/Reading')

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/i
const READING_FIELDS = 'deviceId waterBodyId ammonia temperature salinity pH recordedAt dataSource simulationSessionId'

function parseIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return null

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return null

  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (
    calendarDate.getUTCFullYear() !== year ||
    calendarDate.getUTCMonth() !== month - 1 ||
    calendarDate.getUTCDate() !== day
  ) return null

  return new Date(timestamp)
}

async function getReadings(req, res) {
  const { waterBodyId, from, to, page: pageValue, limit: limitValue, dataSource } = req.query
  if (dataSource !== undefined && !['real', 'simulation'].includes(dataSource)) {
    return res.status(400).json({ success: false, message: 'dataSource must be real or simulation' })
  }

  if (typeof waterBodyId !== 'string' || !waterBodyId.trim()) {
    return res.status(400).json({
      success: false,
      message: 'waterBodyId is required'
    })
  }

  if (!OBJECT_ID_PATTERN.test(waterBodyId)) {
    return res.status(400).json({
      success: false,
      message: 'waterBodyId must be a valid ID'
    })
  }

  const page = pageValue === undefined ? 1 : Number(pageValue)
  const limit = limitValue === undefined ? 20 : Number(limitValue)
  if (pageValue !== undefined && !/^[1-9]\d*$/.test(pageValue)) {
    return res.status(400).json({ success: false, message: 'page must be a positive integer' })
  }
  if (!Number.isSafeInteger(page) || page < 1) {
    return res.status(400).json({ success: false, message: 'page must be a positive integer' })
  }
  if (limitValue !== undefined && !/^[1-9]\d*$/.test(limitValue)) {
    return res.status(400).json({ success: false, message: 'limit must be an integer between 1 and 100' })
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return res.status(400).json({ success: false, message: 'limit must be an integer between 1 and 100' })
  }
  if (!Number.isSafeInteger((page - 1) * limit)) {
    return res.status(400).json({ success: false, message: 'page is too large' })
  }

  let fromDate
  let toDate
  if (from !== undefined) {
    fromDate = parseIsoDate(from)
    if (!fromDate) {
      return res.status(400).json({ success: false, message: 'from must be a valid ISO date' })
    }
  }
  if (to !== undefined) {
    toDate = parseIsoDate(to)
    if (!toDate) {
      return res.status(400).json({ success: false, message: 'to must be a valid ISO date' })
    }
  }
  if (fromDate && toDate && fromDate > toDate) {
    return res.status(400).json({ success: false, message: 'from must be at or before to' })
  }

  try {
    const waterBody = await WaterBody.findOne({
      _id: waterBodyId,
      userId: req.userId
    }).select('_id')

    if (!waterBody) {
      return res.status(404).json({
        success: false,
        message: 'Water body not found'
      })
    }

    const filter = { waterBodyId: waterBody._id }
    if (dataSource === 'simulation') filter.dataSource = 'simulation'
    if (dataSource === 'real') {
      filter.$or = [{ dataSource: 'real' }, { dataSource: { $exists: false } }]
    }
    if (fromDate || toDate) {
      filter.recordedAt = {}
      if (fromDate) filter.recordedAt.$gte = fromDate
      if (toDate) filter.recordedAt.$lte = toDate
    }

    const [readings, total] = await Promise.all([
      Reading.find(filter)
        .select(READING_FIELDS)
        .sort({ recordedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Reading.countDocuments(filter)
    ])

    return res.json({
      success: true,
      readings: readings.map((reading) => ({
        ...reading,
        dataSource: reading.dataSource || 'real',
        simulationSessionId: reading.simulationSessionId || null
      })),
      page,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit)
    })
  } catch (error) {
    console.error('Reading retrieval failed')
    return res.status(500).json({
      success: false,
      message: 'Could not retrieve readings'
    })
  }
}

module.exports = { getReadings }
