
const mongoose = require('mongoose')
const { PARAMETER_KEYS, validateMonitoringLimits } = require('../services/monitoringLimits')

const parameterLimitsSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  min: { type: Number },
  max: { type: Number }
}, { _id: false })

const limitsFields = Object.fromEntries(PARAMETER_KEYS.map((key) => [key, parameterLimitsSchema]))
const monitoringLimitsSchema = new mongoose.Schema(limitsFields, { _id: false })

const waterBodySchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },

    name: {
      type: String,
      required: true,
      trim: true
    },

    location: {
      type: String,
      default: ''
    },

    waterType: {
      type: String,
      enum: ['Pond', 'Lake', 'River', 'Fish Farm', 'Other'],
      required: true
    },

    monitoringLimits: {
      type: monitoringLimitsSchema,
      default: undefined
    },

    monitoringLimitsVersion: {
      type: Number,
      min: 0,
      default: 0
    }
  },
  {
    timestamps: true
  }
)

waterBodySchema.pre('validate', function validateLimits() {
  if (!this.monitoringLimits) return
  const result = validateMonitoringLimits(this.monitoringLimits.toObject())
  for (const error of result.errors) this.invalidate(error.field, error.message)
})

module.exports = mongoose.model('WaterBody', waterBodySchema)
