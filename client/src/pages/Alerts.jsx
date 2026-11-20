import { useEffect, useState } from 'react'
import api from '../services/api'

const labels = { temperature: 'Temperature', pH: 'pH', salinity: 'Salinity', ammonia: 'Ammonia (TAN-N)' }
const stamp = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'

function Alerts() {
  const [alerts, setAlerts] = useState([])
  const [waterBodies, setWaterBodies] = useState([])
  const [status, setStatus] = useState('')
  const [source, setSource] = useState('')
  const [waterBodyId, setWaterBodyId] = useState('')
  const [parameter, setParameter] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api.get('/alerts', { params: { ...(status ? { status } : {}), ...(source ? { dataSource: source } : {}), ...(waterBodyId ? { waterBodyId } : {}), ...(parameter ? { parameter } : {}) }, signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setAlerts(response.data.alerts || []) })
      .catch((requestError) => { if (!controller.signal.aborted) setError(requestError.response?.data?.message || 'Could not load alerts.') })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [status, source, waterBodyId, parameter])

  useEffect(() => {
    const controller = new AbortController()
    api.get('/water-bodies', { signal: controller.signal })
      .then((response) => { if (!controller.signal.aborted) setWaterBodies(response.data.waterBodies || []) })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  return <section className="page-stack">
    <header className="page-heading"><div><p className="section-kicker">MONITORING</p><h2>Alerts</h2><p>Alerts reflect user-configured monitoring limits and recorded measurements.</p></div></header>
    <div className="alert-filters">
      <label className="field-group"><span>Status</span><select value={status} onChange={(event) => { setLoading(true); setError(''); setStatus(event.target.value) }}><option value="">All</option><option value="active">Active</option><option value="resolved">Resolved</option></select></label>
      <label className="field-group"><span>Water body</span><select value={waterBodyId} onChange={(event) => { setLoading(true); setError(''); setWaterBodyId(event.target.value) }}><option value="">All water bodies</option>{waterBodies.map((body) => <option key={body._id} value={body._id}>{body.name}</option>)}</select></label>
      <label className="field-group"><span>Parameter</span><select value={parameter} onChange={(event) => { setLoading(true); setError(''); setParameter(event.target.value) }}><option value="">All parameters</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="field-group"><span>Reading source</span><select value={source} onChange={(event) => { setLoading(true); setError(''); setSource(event.target.value) }}><option value="">All sources</option><option value="real">Device readings</option><option value="simulation">Simulation</option></select></label>
    </div>
    {loading && <p className="inline-state">Loading alerts…</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {!loading && !error && alerts.length === 0 && <div className="empty-panel"><h3>No {status || 'matching'} alerts</h3><p>Alerts appear here when readings cross your configured limits.</p></div>}
    {!loading && alerts.length > 0 && <div className="alert-list">{alerts.map((alert) => <article className="alert-row" key={alert._id}>
      <div><span className={`alert-state alert-state-${alert.status}`}>{alert.status}</span><h3>{labels[alert.parameter] || alert.parameter}</h3><p>{alert.waterBodyId?.name || 'Water body'} · {alert.dataSource === 'simulation' ? 'Simulation' : 'Device reading'}</p></div>
      <dl><div><dt>Observed</dt><dd>{alert.observedValue ?? '—'}</dd></div><div><dt>Configured range</dt><dd>{alert.thresholdSnapshot?.min ?? '—'} – {alert.thresholdSnapshot?.max ?? '—'}</dd></div><div><dt>Direction</dt><dd>{alert.violationDirection === 'below_minimum' ? 'Below minimum' : alert.violationDirection === 'above_maximum' ? 'Above maximum' : 'Unknown'}</dd></div><div><dt>Triggered</dt><dd>{stamp(alert.triggeredAt)}</dd></div><div><dt>Last observed</dt><dd>{stamp(alert.lastObservedAt)}</dd></div>{alert.resolvedAt && <div><dt>Resolved</dt><dd>{stamp(alert.resolvedAt)}</dd></div>}</dl>
    </article>)}</div>}
  </section>
}
export default Alerts
