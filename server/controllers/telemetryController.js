const { ingestTelemetry } = require('../services/telemetryIngestion')

async function receiveTelemetry(req, res) {
  const result = await ingestTelemetry({
    body: req.body,
    device: req.device,
    dataSource: 'real'
  })

  if (!result.ok && result.validationErrors) {
    return res.status(400).json({
      success: false,
      message: 'Sensor telemetry validation failed',
      errors: result.validationErrors
    })
  }
  if (!result.ok) {
    return res.status(result.status || 500).json({
      success: false,
      message: result.message || 'Could not save sensor telemetry'
    })
  }

  const reading = result.reading
  return res.status(201).json({
    success: true,
    message: 'Sensor telemetry saved',
    deviceId: reading.deviceId,
    waterBodyId: reading.waterBodyId,
    recordedAt: reading.recordedAt,
    telemetry: {
      temperature: reading.temperature,
      pH: reading.pH,
      salinity: reading.salinity,
      ammonia: reading.ammonia
    }
  })
}

module.exports = receiveTelemetry
