const mongoose = require('mongoose')

const alertSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    waterBodyId: { type: mongoose.Schema.Types.ObjectId, ref: 'WaterBody', required: true },
    deviceId: { type: String, required: true },
    parameter: {
      type: String,
      enum: ['ammonia', 'temperature', 'salinity', 'pH'],
      required: true
    },
    observedValue: { type: Number, required: true },
    thresholdSnapshot: {
      min: { type: Number, required: true },
      max: { type: Number, required: true }
    },
    violationDirection: {
      type: String,
      enum: ['below_minimum', 'above_maximum', 'unknown'],
      required: true
    },
    triggeredAt: { type: Date, required: true },
    lastObservedAt: { type: Date, required: true },
    status: { type: String, enum: ['active', 'resolved'], default: 'active', index: true },
    resolvedAt: { type: Date, default: null },
    resolutionReason: {
      type: String,
      enum: ['within_range', 'limits_changed', 'monitoring_disabled', 'violation_changed', null],
      default: null
    },
    dataSource: { type: String, enum: ['real', 'simulation'], default: 'real', index: true },
    simulationSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SimulationSession',
      default: null
    },
    monitoringLimitsVersion: { type: Number, default: 0 },

    // Legacy fields remain readable during migration and for older clients.
    value: { type: Number },
    threshold: { type: Number },
    message: { type: String }
  },
  { timestamps: true }
)

alertSchema.index({ userId: 1, status: 1, triggeredAt: -1 })
alertSchema.index({ userId: 1, waterBodyId: 1, parameter: 1, status: 1 })
alertSchema.index(
  {
    userId: 1,
    waterBodyId: 1,
    parameter: 1,
    violationDirection: 1,
    dataSource: 1,
    simulationSessionId: 1
  },
  {
    unique: true,
    partialFilterExpression: { status: 'active', violationDirection: { $exists: true } }
  }
)
alertSchema.index(
  { userId: 1, dataSource: 1, simulationSessionId: 1 },
  { partialFilterExpression: { dataSource: 'simulation' } }
)

module.exports = mongoose.model('Alert', alertSchema)
