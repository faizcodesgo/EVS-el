const express = require('express')

const {
  createWaterBody,
  getWaterBodies,
  updateWaterBody,
  updateMonitoringLimits,
  deleteWaterBody
} = require('../controllers/waterBodyController')

const protect = require('../middleware/authMiddleware')

const router = express.Router()

// All routes require authentication
router.use(protect)

// Create a water body
router.post('/', createWaterBody)

// Get all water bodies belonging to the logged-in user
router.get('/', getWaterBodies)

// Update a water body
router.put('/:id', updateWaterBody)
router.put('/:id/monitoring-limits', updateMonitoringLimits)

// Delete a water body
router.delete('/:id', deleteWaterBody)

module.exports = router
