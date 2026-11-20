const PARAMETER_KEYS = ['temperature', 'pH', 'salinity', 'ammonia']

function validateMonitoringLimits(input) {
  if (input === undefined || input === null) return { value: undefined, errors: [] }
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { value: undefined, errors: [{ field: 'monitoringLimits', message: 'must be an object' }] }
  }

  const errors = []
  const value = {}
  for (const key of Object.keys(input)) {
    if (!PARAMETER_KEYS.includes(key)) errors.push({ field: `monitoringLimits.${key}`, message: 'is not a supported parameter' })
  }

  for (const key of PARAMETER_KEYS) {
    const limit = input[key]
    if (limit === undefined) continue
    if (!limit || typeof limit !== 'object' || Array.isArray(limit)) {
      errors.push({ field: `monitoringLimits.${key}`, message: 'must be an object' })
      continue
    }

    const enabled = limit.enabled === undefined ? false : limit.enabled
    if (typeof enabled !== 'boolean') {
      errors.push({ field: `monitoringLimits.${key}.enabled`, message: 'must be true or false' })
      continue
    }

    const hasMin = Object.prototype.hasOwnProperty.call(limit, 'min') && limit.min !== null && limit.min !== ''
    const hasMax = Object.prototype.hasOwnProperty.call(limit, 'max') && limit.max !== null && limit.max !== ''
    if (hasMin !== hasMax) {
      errors.push({ field: `monitoringLimits.${key}`, message: 'minimum and maximum must both be provided' })
      continue
    }

    const normalized = { enabled }
    if (hasMin && hasMax) {
      if (typeof limit.min !== 'number' || !Number.isFinite(limit.min)) {
        errors.push({ field: `monitoringLimits.${key}.min`, message: 'must be a finite number' })
      }
      if (typeof limit.max !== 'number' || !Number.isFinite(limit.max)) {
        errors.push({ field: `monitoringLimits.${key}.max`, message: 'must be a finite number' })
      }
      if (typeof limit.min === 'number' && Number.isFinite(limit.min) &&
          typeof limit.max === 'number' && Number.isFinite(limit.max)) {
        if (limit.min >= limit.max) {
          errors.push({ field: `monitoringLimits.${key}`, message: 'minimum must be lower than maximum' })
        }
        if ((key === 'salinity' || key === 'ammonia') && limit.min < 0) {
          errors.push({ field: `monitoringLimits.${key}.min`, message: 'must be zero or greater' })
        }
        if (key === 'pH' && (limit.min < 0 || limit.max > 14)) {
          errors.push({ field: `monitoringLimits.${key}`, message: 'must be within the sensor validation range of 0 to 14' })
        }
      }
      normalized.min = limit.min
      normalized.max = limit.max
    } else if (enabled) {
      errors.push({ field: `monitoringLimits.${key}`, message: 'enabled monitoring requires minimum and maximum values' })
    }
    value[key] = normalized
  }

  return { value, errors }
}

module.exports = { PARAMETER_KEYS, validateMonitoringLimits }
