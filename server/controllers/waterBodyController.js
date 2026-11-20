
const WaterBody = require('../models/WaterBody')
const { validateMonitoringLimits } = require('../services/monitoringLimits')

function limitsFromRequest(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'monitoringLimits')) return { supplied: false }
  const result = validateMonitoringLimits(body.monitoringLimits)
  return { supplied: true, value: result.value, errors: result.errors }
}

function sendLimitValidationError(res, errors) {
  return res.status(400).json({
    success: false,
    message: 'Monitoring limits are invalid',
    errors
  })
}

// Add a water body
async function createWaterBody(req, res) {
  try {
    const { name, location, waterType } = req.body
    const limitResult = limitsFromRequest(req.body)

    if (!name || !waterType) {
      return res.status(400).json({
        success: false,
        message: 'Name and water type are required'
      })
    }

    if (limitResult.errors?.length) return sendLimitValidationError(res, limitResult.errors)

    const waterBodyData = {
      userId: req.userId,
      name,
      location,
      waterType
    }
    if (limitResult.supplied && limitResult.value) {
      waterBodyData.monitoringLimits = limitResult.value
      waterBodyData.monitoringLimitsVersion = 1
    }
    const waterBody = await WaterBody.create(waterBodyData)

    return res.status(201).json({
      success: true,
      waterBody
    })
  } catch (error) {
    console.error('Create water body error:', error.message)

    return res.status(500).json({
      success: false,
      message: 'Could not create water body'
    })
  }
}

// Get all water bodies belonging to the logged-in user
async function getWaterBodies(req, res) {
  try {
    const waterBodies = await WaterBody.find({
      userId: req.userId
    }).sort({ createdAt: -1 })

    return res.json({
      success: true,
      waterBodies
    })
  } catch (error) {
    console.error('Get water bodies error:', error.message)

    return res.status(500).json({
      success: false,
      message: 'Could not fetch water bodies'
    })
  }
}
// Update a water body
async function updateWaterBody(req, res) {
  try {
    const { name, location, waterType } = req.body
    const limitResult = limitsFromRequest(req.body)

    if (!name || !name.trim() || !waterType) {
      return res.status(400).json({
        success: false,
        message: 'Name and water type are required'
      })
    }
    if (limitResult.errors?.length) return sendLimitValidationError(res, limitResult.errors)

    const update = {
      name: name.trim(),
      location: location?.trim() || '',
      waterType
    }
    if (limitResult.supplied) {
      update.monitoringLimits = limitResult.value
      update.$inc = { monitoringLimitsVersion: 1 }
    }

    const waterBody = await WaterBody.findOneAndUpdate(
      {
        _id: req.params.id,
        userId: req.userId
      },
      update,
      {
        new: true,
        runValidators: true
      }
    )

    if (!waterBody) {
      return res.status(404).json({
        success: false,
        message: 'Water body not found'
      })
    }

    return res.json({
      success: true,
      waterBody
    })
  } catch (error) {
    console.error('Update water body error:', error.message)

    return res.status(500).json({
      success: false,
      message: 'Could not update water body'
    })
  }
}

async function updateMonitoringLimits(req, res) {
  const limitResult = validateMonitoringLimits(req.body?.monitoringLimits)
  if (limitResult.errors.length) return sendLimitValidationError(res, limitResult.errors)

  try {
    const waterBody = await WaterBody.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      {
        $set: { monitoringLimits: limitResult.value },
        $inc: { monitoringLimitsVersion: 1 }
      },
      { new: true, runValidators: true }
    )
    if (!waterBody) {
      return res.status(404).json({ success: false, message: 'Water body not found' })
    }
    return res.json({ success: true, waterBody })
  } catch {
    return res.status(500).json({ success: false, message: 'Could not update monitoring limits' })
  }
}

// Delete a water body
async function deleteWaterBody(req, res) {
  try {
    const waterBody = await WaterBody.findOneAndDelete({
      _id: req.params.id,
      userId: req.userId
    })

    if (!waterBody) {
      return res.status(404).json({
        success: false,
        message: 'Water body not found'
      })
    }

    return res.json({
      success: true,
      message: 'Water body deleted successfully'
    })
  } catch (error) {
    console.error('Delete water body error:', error.message)

    return res.status(500).json({
      success: false,
      message: 'Could not delete water body'
    })
  }
}
module.exports = {
  createWaterBody,
  getWaterBodies,
  updateWaterBody,
  updateMonitoringLimits,
  deleteWaterBody
}
