
const mongoose = require('mongoose')

const readingSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      index: true
    },

    waterBodyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WaterBody',
      required: true,
      index: true
    },

    ammonia: {
      type: Number,
      min: 0,
      required: true
    },

    temperature: {
      type: Number,
      required: true
    },

    salinity: {
      type: Number,
      min: 0,
      required: true
    },

    pH: {
      type: Number,
      min: 0,
      max: 14,
      required: true
    },

    recordedAt: {
      type: Date,
      default: Date.now,
      index: true
    },

    dataSource: {
      type: String,
      enum: ['real', 'simulation'],
      default: 'real',
      index: true
    },

    simulationSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SimulationSession',
      default: null
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    }
  },
  {
    timestamps: true
  }
)

// Efficiently retrieve readings for a water body over time
readingSchema.index({ waterBodyId: 1, recordedAt: -1 })
readingSchema.index(
  { userId: 1, dataSource: 1, simulationSessionId: 1 },
  { partialFilterExpression: { dataSource: 'simulation' } }
)
readingSchema.index({ waterBodyId: 1, dataSource: 1, recordedAt: -1 })

module.exports = mongoose.model('Reading', readingSchema)
