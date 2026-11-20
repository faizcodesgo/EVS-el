const mongoose = require('mongoose')
const Alert = require('../models/Alert')
const WaterBody = require('../models/WaterBody')

const PARAMETERS = ['temperature', 'pH', 'salinity', 'ammonia']
const STATUSES = ['active', 'resolved']
const SOURCES = ['real', 'simulation']

async function getAlerts(req, res) {
  const { status, waterBodyId, parameter, dataSource } = req.query
  const page = req.query.page === undefined ? 1 : Number(req.query.page)
  const limit = req.query.limit === undefined ? 20 : Number(req.query.limit)
  if (!Number.isSafeInteger(page) || page < 1 || (req.query.page && !/^\d+$/.test(req.query.page))) {
    return res.status(400).json({ success: false, message: 'page must be a positive integer' })
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (req.query.limit && !/^\d+$/.test(req.query.limit))) {
    return res.status(400).json({ success: false, message: 'limit must be between 1 and 100' })
  }
  if (status && !STATUSES.includes(status)) return res.status(400).json({ success: false, message: 'Invalid alert status' })
  if (parameter && !PARAMETERS.includes(parameter)) return res.status(400).json({ success: false, message: 'Invalid parameter' })
  if (dataSource && !SOURCES.includes(dataSource)) return res.status(400).json({ success: false, message: 'Invalid data source' })
  if (waterBodyId && !mongoose.isValidObjectId(waterBodyId)) {
    return res.status(400).json({ success: false, message: 'Invalid waterBodyId' })
  }

  try {
    const ownedBodies = await WaterBody.find({ userId: req.userId }).select('_id')
    const ownedIds = ownedBodies.map((body) => body._id)
    if (waterBodyId && !ownedIds.some((id) => String(id) === waterBodyId)) {
      return res.status(404).json({ success: false, message: 'Water body not found' })
    }

    const filter = {
      waterBodyId: waterBodyId || { $in: ownedIds },
      $or: [{ userId: req.userId }, { userId: { $exists: false } }]
    }
    if (status) filter.status = status
    if (parameter) filter.parameter = parameter
    if (dataSource === 'simulation') filter.dataSource = 'simulation'
    if (dataSource === 'real') {
      filter.$and = [{ $or: [{ dataSource: 'real' }, { dataSource: { $exists: false } }] }]
    }

    const [alerts, total] = await Promise.all([
      Alert.find(filter)
        .populate('waterBodyId', 'name location')
        .sort({ triggeredAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Alert.countDocuments(filter)
    ])

    const normalized = alerts.map((alert) => ({
      ...alert,
      observedValue: alert.observedValue ?? alert.value,
      thresholdSnapshot: alert.thresholdSnapshot || { min: null, max: alert.threshold ?? null },
      violationDirection: alert.violationDirection || 'unknown',
      triggeredAt: alert.triggeredAt || alert.createdAt,
      lastObservedAt: alert.lastObservedAt || alert.updatedAt || alert.createdAt,
      dataSource: alert.dataSource || 'real',
      simulationSessionId: alert.simulationSessionId || null
    }))
    return res.json({
      success: true,
      alerts: normalized,
      page,
      pageSize: limit,
      total,
      totalPages: Math.ceil(total / limit)
    })
  } catch {
    return res.status(500).json({ success: false, message: 'Could not retrieve alerts' })
  }
}

module.exports = { getAlerts }
