const SimulationSession = require('../models/SimulationSession')
const simulationService = require('../services/simulationService')

const scenarios = ['normal', 'above', 'below', 'recovery', 'invalid']

async function listSimulations(req, res) {
  try {
    const sessions = await SimulationSession.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(100).lean()
    return res.json({ success: true, sessions })
  } catch {
    return res.status(500).json({ success: false, message: 'Could not retrieve simulations' })
  }
}

async function createSimulation(req, res) {
  const { waterBodyId, scenario, intervalMs = 5000, sampleCount = 20, seedValues = {} } = req.body || {}
  if (typeof waterBodyId !== 'string' || !/^[a-f\d]{24}$/i.test(waterBodyId)) return res.status(400).json({ success: false, message: 'A valid waterBodyId is required' })
  if (!scenarios.includes(scenario)) return res.status(400).json({ success: false, message: 'Invalid simulation scenario' })
  if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 3600000) return res.status(400).json({ success: false, message: 'intervalMs must be between 1000 and 3600000' })
  if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 500) return res.status(400).json({ success: false, message: 'sampleCount must be between 1 and 500' })
  if (!seedValues || typeof seedValues !== 'object' || Array.isArray(seedValues) || Object.keys(seedValues).some((key) => !['temperature', 'pH', 'salinity', 'ammonia'].includes(key) || typeof seedValues[key] !== 'number' || !Number.isFinite(seedValues[key]))) return res.status(400).json({ success: false, message: 'seedValues must contain only finite sensor values' })
  try {
    const result = await simulationService.startSimulation({ userId: req.userId, waterBodyId, scenario, intervalMs, sampleCount, seedValues })
    if (result.status) return res.status(result.status).json({ success: false, message: result.message })
  return res.status(201).json({ success: true, session: result.session })
  } catch {
    return res.status(500).json({ success: false, message: 'Could not start simulation' })
  }
}

async function stopSimulation(req, res) {
  try {
    const session = await SimulationSession.findOne({ _id: req.params.id, userId: req.userId })
    if (!session) return res.status(404).json({ success: false, message: 'Simulation not found' })
    const updated = await simulationService.stopSimulation(session)
    return res.json({ success: true, session: updated })
  } catch { return res.status(500).json({ success: false, message: 'Could not stop simulation' }) }
}

async function deleteSimulation(req, res) {
  try {
    const session = await SimulationSession.findOne({ _id: req.params.id, userId: req.userId })
    if (!session) return res.status(404).json({ success: false, message: 'Simulation not found' })
    await simulationService.deleteSimulation(session)
    return res.json({ success: true, message: 'Simulation and its generated records were deleted' })
  } catch { return res.status(500).json({ success: false, message: 'Could not delete simulation data' }) }
}

module.exports = { listSimulations, createSimulation, stopSimulation, deleteSimulation }
