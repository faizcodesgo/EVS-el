const express = require('express')
const protect = require('../middleware/authMiddleware')
const { listSimulations, createSimulation, stopSimulation, deleteSimulation } = require('../controllers/simulationController')

const router = express.Router()
router.use(protect)
router.get('/', listSimulations)
router.post('/', createSimulation)
router.post('/:id/stop', stopSimulation)
router.delete('/:id', deleteSimulation)
module.exports = router
