const mongoose = require('mongoose')

const simulationSessionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  waterBodyId: { type: mongoose.Schema.Types.ObjectId, ref: 'WaterBody', required: true, index: true },
  deviceId: { type: String, required: true },
  scenario: { type: String, enum: ['normal', 'above', 'below', 'recovery', 'invalid'], required: true },
  status: { type: String, enum: ['running', 'stopping', 'stopped', 'completed', 'interrupted', 'deleting'], default: 'running', index: true },
  intervalMs: { type: Number, required: true },
  sampleCount: { type: Number, required: true },
  samplesGenerated: { type: Number, default: 0 },
  samplesAttempted: { type: Number, default: 0 },
  seedValues: { type: mongoose.Schema.Types.Mixed, default: {} },
  startedAt: { type: Date, default: Date.now },
  stoppedAt: { type: Date, default: null },
  lastError: { type: String, default: null }
}, { timestamps: true })

simulationSessionSchema.index({ userId: 1, createdAt: -1 })
module.exports = mongoose.model('SimulationSession', simulationSessionSchema)
