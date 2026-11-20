const express = require('express')
const protect = require('../middleware/authMiddleware')
const { getAlerts } = require('../controllers/alertController')

const router = express.Router()
router.use(protect)
router.get('/', getAlerts)

module.exports = router
