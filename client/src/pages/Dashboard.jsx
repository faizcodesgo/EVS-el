import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import api from '../services/api'
import SimulationPanel from '../components/SimulationPanel'
import { getReferenceLabel, getReferenceStatus } from '../config/parameterReferences'

const PAGE_LIMIT = 100
const EMPTY_READINGS = []

const parameters = [
  { key: 'temperature', name: 'Temperature', unit: '°C', color: '#43A987' },
  { key: 'pH', name: 'pH', unit: '', color: '#246B59' },
  { key: 'salinity', name: 'Salinity', unit: '', color: '#39BFC8' },
  { key: 'ammonia', name: 'Ammonia', unit: 'mg/L', qualifier: 'TAN-N', color: '#39BFC8' }
]

function localDateValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatTimestamp(value) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Timestamp unavailable'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatNumber(value) {
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function getSelectedDevice(devices, waterBodyId) {
  return devices.find((device) => {
    const assignedId = device.waterBodyId?._id || device.waterBodyId
    return String(assignedId) === String(waterBodyId)
  })
}

function getDateRange(preset, customFrom, customTo) {
  if (preset === 'custom') {
    if (!customFrom || !customTo) return null
    const fromDate = new Date(`${customFrom}T00:00:00`)
    const toDate = new Date(`${customTo}T00:00:00`)
    toDate.setDate(toDate.getDate() + 1)
    return {
      from: fromDate.toISOString(),
      to: new Date(toDate.getTime() - 1).toISOString()
    }
  }

  const now = new Date()
  const duration = preset === '24h' ? 24 * 60 * 60 * 1000
    : preset === '30d' ? 30 * 24 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000
  return { from: new Date(now.getTime() - duration).toISOString(), to: now.toISOString() }
}

function MetricCard({ parameter, reading, readings }) {
  const values = readings
    .map((item) => item[parameter.key])
    .filter((value) => typeof value === 'number' && Number.isFinite(value))

  return (
    <article className="metric-card" style={{ '--metric-accent': parameter.color }}>
      <div className="metric-card-heading">
        <div>
          <h3>{parameter.name}</h3>
          {parameter.qualifier && <span className="metric-qualifier">{parameter.qualifier}</span>}
        </div>
        <span className="metric-unit">{parameter.key === 'salinity' ? 'Unit unspecified' : parameter.unit || 'Unitless'}</span>
      </div>
      <p className="metric-value">
        {reading && typeof reading[parameter.key] === 'number'
          ? `${formatNumber(reading[parameter.key])}${parameter.unit ? ` ${parameter.unit}` : ''}`
          : 'No reading'}
      </p>
      <p className="metric-timestamp">
        {reading ? `Recorded ${formatTimestamp(reading.recordedAt)}` : 'No stored value'}
      </p>
      {values.length >= 2 && (
        <div className="metric-sparkline" role="img" aria-label={`${parameter.name} trend from actual readings`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={readings}>
              <Line type="monotone" dataKey={parameter.key} stroke={parameter.color} strokeWidth={1.8} dot={false} connectNulls={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="reference-unconfigured">
        {getReferenceStatus(parameter.key, reading?.[parameter.key]) || getReferenceLabel(parameter.key)}
      </p>
      {parameter.key === 'ammonia' && (
        <p className="metric-caveat">TAN-N is not equivalent to un-ionized NH₃. The un-ionized fraction depends on pH and temperature; a reliable toxicity assessment is unavailable without appropriate speciation and reference data.</p>
      )}
    </article>
  )
}

function formatChartTime(value) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value)
}

function ParameterChart({ parameter, data }) {
  const values = data.map((item) => item[parameter.key]).filter((value) => Number.isFinite(value))
  const enoughForStats = values.length >= 2
  const stats = enoughForStats ? values.reduce((summary, value) => ({
    min: Math.min(summary.min, value),
    max: Math.max(summary.max, value),
    sum: summary.sum + value
  }), { min: Infinity, max: -Infinity, sum: 0 }) : null

  return (
    <article className="chart-panel">
      <header className="chart-heading">
        <div>
          <p className="chart-kicker">{parameter.qualifier || 'SENSOR SERIES'}</p>
          <h3>{parameter.name}{parameter.unit ? ` (${parameter.unit})` : ''}</h3>
        </div>
      </header>
      <div className="chart-plot">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid stroke="#DDF5EA" vertical={false} />
            <XAxis
              dataKey="timestamp"
              type="number"
              scale="time"
              domain={['dataMin', 'dataMax']}
              tickFormatter={formatChartTime}
              tick={{ fill: '#668078', fontSize: 10 }}
              axisLine={{ stroke: '#A3DCC5' }}
              tickLine={false}
              minTickGap={24}
            />
            <YAxis
              width={48}
              tick={{ fill: '#668078', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              domain={['auto', 'auto']}
            />
            <Tooltip
              labelFormatter={(value) => formatTimestamp(value)}
              formatter={(value) => [`${value}${parameter.unit ? ` ${parameter.unit}` : ''}`, parameter.name]}
              contentStyle={{ background: '#FFFFFF', border: '1px solid #A3DCC5', borderRadius: 10, color: '#173B35' }}
              labelStyle={{ color: '#668078' }}
              itemStyle={{ color: '#173B35' }}
            />
            <Line
              type="monotone"
              dataKey={parameter.key}
              name={parameter.name}
              stroke={parameter.color}
              strokeWidth={2.2}
              dot={data.length < 2 ? { r: 3, fill: parameter.color } : false}
              activeDot={{ r: 5, fill: parameter.color, stroke: '#FFFFFF' }}
              connectNulls={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {stats ? (
        <dl className="chart-statistics">
          <div><dt>Minimum</dt><dd>{formatNumber(stats.min)}</dd></div>
          <div><dt>Average</dt><dd>{formatNumber(stats.sum / values.length)}</dd></div>
          <div><dt>Maximum</dt><dd>{formatNumber(stats.max)}</dd></div>
        </dl>
      ) : (
        <p className="chart-statistics-note">At least two measured values are needed for summary statistics.</p>
      )}
    </article>
  )
}

function Dashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedWaterBodyId = searchParams.get('waterBodyId') || ''
  const [waterBodies, setWaterBodies] = useState([])
  const [devices, setDevices] = useState([])
  const [directoryLoading, setDirectoryLoading] = useState(true)
  const [directoryError, setDirectoryError] = useState('')
  const [deviceError, setDeviceError] = useState('')
  const [preset, setPreset] = useState('7d')
  const [dataSource, setDataSource] = useState('real')
  const [customFrom, setCustomFrom] = useState(() => localDateValue(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)))
  const [customTo, setCustomTo] = useState(() => localDateValue(new Date()))
  const [latestResult, setLatestResult] = useState({ key: '', reading: null, error: '' })
  const [historyResult, setHistoryResult] = useState({ key: '', readings: [], total: 0, error: '' })
  const [refreshVersion, setRefreshVersion] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function loadDirectory() {
      const [bodies, deviceList] = await Promise.allSettled([
        api.get('/water-bodies', { signal: controller.signal }),
        api.get('/devices', { signal: controller.signal })
      ])
      if (controller.signal.aborted) return

      if (bodies.status === 'fulfilled') {
        const items = bodies.value.data.waterBodies || []
        setWaterBodies(items)
      } else {
        setDirectoryError(bodies.reason.response?.data?.message || 'Could not load your water bodies.')
      }

      if (deviceList.status === 'fulfilled') {
        setDevices(deviceList.value.data.devices || [])
      } else {
        setDeviceError(deviceList.reason.response?.data?.message || 'Could not load device information.')
      }
      setDirectoryLoading(false)
    }
    loadDirectory()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (directoryLoading || directoryError) return

    if (waterBodies.length === 0) {
      if (selectedWaterBodyId) setSearchParams({}, { replace: true })
      return
    }

    const selectionIsOwned = waterBodies.some((body) => String(body._id) === String(selectedWaterBodyId))
    if (!selectionIsOwned) {
      setSearchParams({ waterBodyId: waterBodies[0]._id }, { replace: true })
    }
  }, [directoryLoading, directoryError, waterBodies, selectedWaterBodyId, setSearchParams])

  const dateRange = useMemo(() => getDateRange(preset, customFrom, customTo), [preset, customFrom, customTo])
  const customRangeInvalid = preset === 'custom' && customFrom && customTo && customFrom > customTo
  const selectedWaterBody = waterBodies.find((body) => String(body._id) === String(selectedWaterBodyId))
  const latestKey = selectedWaterBodyId && selectedWaterBody && !directoryLoading && !directoryError
    ? `${selectedWaterBodyId}|${dataSource}|${refreshVersion}`
    : ''
  const queryKey = selectedWaterBodyId && selectedWaterBody && !directoryLoading && !directoryError && dateRange && !customRangeInvalid
    ? `${selectedWaterBodyId}|${dateRange.from}|${dateRange.to}|${dataSource}|${refreshVersion}`
    : ''

  useEffect(() => {
    if (!latestKey) return undefined
    const controller = new AbortController()

    api.get('/readings', {
      params: { waterBodyId: selectedWaterBodyId, page: 1, limit: 1, ...(dataSource ? { dataSource } : {}) },
      signal: controller.signal
    })
      .then((response) => {
        if (!controller.signal.aborted) {
          setLatestResult({
            key: latestKey,
            reading: response.data.readings?.[0] || null,
            error: ''
          })
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLatestResult({
            key: latestKey,
            reading: null,
            error: error.response?.data?.message || 'Could not load the latest stored reading.'
          })
        }
      })

    return () => controller.abort()
  }, [latestKey, selectedWaterBodyId, dataSource])

  useEffect(() => {
    const refresh = () => {
      setRefreshVersion((value) => value + 1)
    }
    window.addEventListener('hydrogen-readings-updated', refresh)
    return () => window.removeEventListener('hydrogen-readings-updated', refresh)
  }, [])

  useEffect(() => {
    if (!queryKey || !dateRange) return undefined
    const controller = new AbortController()

    async function loadReadings() {
      try {
        const params = { waterBodyId: selectedWaterBodyId, from: dateRange.from, to: dateRange.to, page: 1, limit: PAGE_LIMIT, ...(dataSource ? { dataSource } : {}) }
        const firstPage = await api.get('/readings', { params, signal: controller.signal })
        const pages = [firstPage.data.readings || []]
        const totalPages = firstPage.data.totalPages || 0
        for (let page = 2; page <= totalPages; page += 1) {
          if (controller.signal.aborted) return
          const nextPage = await api.get('/readings', {
            params: { ...params, page },
            signal: controller.signal
          })
          pages.push(nextPage.data.readings || [])
        }
        if (!controller.signal.aborted) {
          setHistoryResult({
            key: queryKey,
            readings: pages.flat(),
            total: firstPage.data.total || 0,
            error: ''
          })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setHistoryResult({
            key: queryKey,
            readings: [],
            total: 0,
            error: error.response?.data?.message || 'Could not load readings for this range.'
          })
        }
      }
    }

    loadReadings()
    return () => controller.abort()
  }, [queryKey, selectedWaterBodyId, dateRange, dataSource])

  const assignedDevice = getSelectedDevice(devices, selectedWaterBodyId)
  const latestMatchesSelection = Boolean(latestKey && latestResult.key === latestKey)
  const latestReading = latestMatchesSelection ? latestResult.reading : null
  const latestError = latestMatchesSelection ? latestResult.error : ''
  const latestLoading = Boolean(latestKey && !latestMatchesSelection)
  const resultMatchesQuery = Boolean(queryKey && historyResult.key === queryKey)
  const readings = resultMatchesQuery ? historyResult.readings : EMPTY_READINGS
  const readingError = resultMatchesQuery ? historyResult.error : ''
  const readingsLoading = Boolean(selectedWaterBodyId && selectedWaterBody && !directoryLoading && dateRange && !customRangeInvalid && !resultMatchesQuery)
  const chartData = useMemo(() => [...readings]
    .sort((first, second) => new Date(first.recordedAt) - new Date(second.recordedAt))
    .map((reading) => ({ ...reading, timestamp: new Date(reading.recordedAt).getTime() })), [readings])

  function handleWaterBodyChange(event) {
    const id = event.target.value
    setSearchParams(id ? { waterBodyId: id } : {}, { replace: true })
  }

  return (
    <section className="page-stack monitoring-page">
      <div className="monitoring-context content-panel dashboard-hero">
        <div className="monitoring-context-title">
          <p className="section-kicker">SELECTED WATER BODY</p>
          {directoryLoading ? <p className="inline-state">Loading water bodies…</p>
            : directoryError ? <p className="inline-error" role="alert">{directoryError}</p>
              : waterBodies.length === 0 ? <h2>No water bodies registered</h2>
                : <>
                  <h2>{selectedWaterBody?.name || 'Choose a water body'}</h2>
                  <p>{selectedWaterBody?.location || 'Location not specified'}{selectedWaterBody?.waterType ? ` · ${selectedWaterBody.waterType}` : ''}</p>
                </>}
        </div>
        <div className="hero-controls">
          <label className="field-group monitoring-selector">
            <span>Water body</span>
            <select value={selectedWaterBodyId} onChange={handleWaterBodyChange} disabled={directoryLoading || waterBodies.length === 0}>
              {waterBodies.length === 0 && <option value="">No water bodies available</option>}
              {waterBodies.map((body) => <option key={body._id} value={body._id}>{body.name}</option>)}
            </select>
          </label>
          <div className="context-device">
            <span className="context-device-label">ASSIGNED GLOB</span>
            {deviceError ? <span className="inline-error">{deviceError}</span>
              : assignedDevice ? <>
                <strong>{assignedDevice.deviceId}</strong>
                <span className={`status-label status-${assignedDevice.status}`}><span className="status-dot" />{assignedDevice.status === 'online' ? 'Online' : 'Offline'}</span>
              </> : <span>{directoryLoading ? 'Loading device…' : 'No device assigned'}</span>}
          </div>
        </div>
      </div>

      {waterBodies.length === 0 && !directoryLoading && !directoryError ? (
        <div className="empty-panel">
          <h3>Start by registering a water body</h3>
          <p>HydroGen displays readings after a Glob device is assigned and sends sensor data.</p>
          <Link className="button button-primary" to="/water-bodies/register">Register Water Body</Link>
        </div>
      ) : selectedWaterBody && (
        <>
          <section className="metric-section" aria-labelledby="summary-title">
            <div className="section-heading-row">
              <div>
                <p className="section-kicker">CURRENT MEASUREMENTS</p>
                <h2 id="summary-title">Latest sensor readings</h2>
              </div>
              <p className="data-freshness-note">
                {latestLoading ? 'Loading latest stored reading…'
                  : latestError ? 'Latest reading unavailable'
                    : latestReading ? `Latest stored ${latestReading.dataSource === 'simulation' ? 'simulation' : 'device'} sample · ${formatTimestamp(latestReading.recordedAt)}`
                      : 'No readings have been stored'}
              </p>
            </div>

            {latestError && <p className="inline-error" role="alert">{latestError}</p>}
            {latestLoading && <p className="inline-state">Loading latest reading…</p>}
            {customRangeInvalid && <p className="inline-error" role="alert">The start date must be on or before the end date.</p>}
            {preset === 'custom' && (!customFrom || !customTo) && <p className="inline-state">Choose both dates to load readings.</p>}

            {!latestLoading && !latestError && (
              <div className="metric-grid">
                {parameters.map((parameter) => (
                  <MetricCard key={parameter.key} parameter={parameter} reading={latestReading} readings={chartData} />
                ))}
              </div>
            )}
          </section>

          <section className="historical-section" id="historical" aria-labelledby="history-title">
            <div className="section-heading-row historical-heading">
              <div>
                <p className="section-kicker">MEASURED HISTORY</p>
                <h2 id="history-title">Readings over time</h2>
                <p className="section-description">Charts show actual stored measurements. Missing values remain gaps.</p>
              </div>
              <div className="range-control">
                <label htmlFor="reading-source">Reading source</label>
                <select id="reading-source" value={dataSource} onChange={(event) => setDataSource(event.target.value)}><option value="">All sources</option><option value="real">Device readings</option><option value="simulation">Simulation</option></select>
                <label htmlFor="date-range">Date range</label>
                <select id="date-range" value={preset} onChange={(event) => setPreset(event.target.value)}>
                  <option value="24h">Last 24 hours</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
              </div>
            </div>

            {preset === 'custom' && (
              <div className="custom-range-fields">
                <label className="field-group"><span>From</span><input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} /></label>
                <label className="field-group"><span>To</span><input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} /></label>
              </div>
            )}

            {readingError && <p className="inline-error" role="alert">{readingError}</p>}
            {readingsLoading && <p className="inline-state">Loading measured history…</p>}
            {!readingsLoading && !readingError && !customRangeInvalid && dateRange && readings.length === 0 && (
              <div className="empty-panel"><h3>No readings in this date range</h3><p>Try a wider range or check that the Glob device has submitted sensor data.</p></div>
            )}
            {!readingsLoading && !readingError && readings.length > 0 && (
              <>
                <p className="reading-count">{historyResult.total.toLocaleString()} stored readings in this range</p>
                <div className="chart-grid">
                  {parameters.map((parameter) => <ParameterChart key={parameter.key} parameter={parameter} data={chartData} />)}
                </div>
              </>
            )}
          </section>
          <SimulationPanel waterBodyId={selectedWaterBodyId} />
        </>
      )}
    </section>
  )
}

export default Dashboard
