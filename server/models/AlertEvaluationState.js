const mongoose = require('mongoose')

const alertEvaluationStateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  waterBodyId: { type: mongoose.Schema.Types.ObjectId, ref: 'WaterBody', required: true },
  parameter: { type: String, enum: ['ammonia', 'temperature', 'salinity', 'pH'], required: true },
  dataSource: { type: String, enum: ['real', 'simulation'], required: true },
  simulationSessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'SimulationSession', default: null },
  lastEvaluatedAt: { type: Date, default: null },
  evaluationVersion: { type: Number, default: 0 },
  activeAlertId: { type: mongoose.Schema.Types.ObjectId, ref: 'Alert', default: null }
}, { timestamps: true })

alertEvaluationStateSchema.index(
  { userId: 1, waterBodyId: 1, parameter: 1, dataSource: 1, simulationSessionId: 1 },
  { unique: true }
)

module.exports = mongoose.model('AlertEvaluationState', alertEvaluationStateSchema)
