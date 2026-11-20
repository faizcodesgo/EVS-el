import { useEffect, useState } from 'react'
import api from '../services/api'

const sensorKeys = ['temperature', 'pH', 'salinity', 'ammonia']

function SimulationPanel({ waterBodyId }) {
  const [sessions, setSessions] = useState([])
  const [scenario, setScenario] = useState('normal')
  const [sampleCount, setSampleCount] = useState(12)
  const [intervalMs, setIntervalMs] = useState(5000)
  const [seedValues, setSeedValues] = useState({ temperature: '', pH: '', salinity: '', ammonia: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function loadSessions(signal) {
    try {
      const response = await api.get('/simulations', { signal })
      if (!signal?.aborted) setSessions((response.data.sessions || []).filter((session) => String(session.waterBodyId) === String(waterBodyId)))
    } catch (requestError) {
      if (!signal?.aborted) setError(requestError.response?.data?.message || 'Could not load simulations.')
    }
  }

  useEffect(() => {
    if (!waterBodyId) return undefined
    const controller = new AbortController()
    api.get('/simulations', { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setSessions((response.data.sessions || []).filter((session) => String(session.waterBodyId) === String(waterBodyId)))
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError(requestError.response?.data?.message || 'Could not load simulations.')
      })
    return () => controller.abort()
  }, [waterBodyId])

  const hasRunningSession = sessions.some((session) => ['running', 'stopping'].includes(session.status))
  useEffect(() => {
    if (!waterBodyId || !hasRunningSession) return undefined
    const timer = window.setInterval(() => {
      api.get('/simulations')
        .then((response) => {
          const current = (response.data.sessions || []).filter((session) => String(session.waterBodyId) === String(waterBodyId))
          setSessions(current)
          window.dispatchEvent(new Event('hydrogen-readings-updated'))
        })
        .catch(() => {})
    }, 3000)
    return () => window.clearInterval(timer)
  }, [waterBodyId, hasRunningSession])

  async function start(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const values = Object.fromEntries(sensorKeys.filter((key) => seedValues[key] !== '').map((key) => [key, Number(seedValues[key])]))
      await api.post('/simulations', { waterBodyId, scenario, sampleCount: Number(sampleCount), intervalMs: Number(intervalMs), seedValues: values })
      await loadSessions()
      window.dispatchEvent(new Event('hydrogen-readings-updated'))
    } catch (requestError) { setError(requestError.response?.data?.message || 'Could not start simulation.') }
    finally { setBusy(false) }
  }

  async function action(session, kind) {
    if (kind === 'delete' && !window.confirm('Delete this simulation session and its generated readings and alerts?')) return
    setBusy(true); setError('')
    try {
      if (kind === 'stop') await api.post(`/simulations/${session._id}/stop`)
      else await api.delete(`/simulations/${session._id}`)
      await loadSessions()
      window.dispatchEvent(new Event('hydrogen-readings-updated'))
    } catch (requestError) { setError(requestError.response?.data?.message || 'Could not update this simulation.') }
    finally { setBusy(false) }
  }

  if (import.meta.env.PROD && import.meta.env.VITE_ENABLE_SIMULATION !== 'true') return null

  return <section className="simulation-panel content-panel">
    <div className="section-heading-row"><div><p className="section-kicker">DEVELOPMENT TOOL</p><h2>Simulation mode</h2><p className="section-description">Generated readings are labeled separately from Glob device telemetry.</p></div></div>
    <form className="simulation-form" onSubmit={start}>
      <label className="field-group"><span>Scenario</span><select value={scenario} onChange={(event) => setScenario(event.target.value)}><option value="normal">Normal</option><option value="above">Above configured maximum</option><option value="below">Below configured minimum</option><option value="recovery">Violation then recovery</option><option value="invalid">Invalid pH (rejection check)</option></select></label>
      <label className="field-group"><span>Samples (1–500)</span><input type="number" min="1" max="500" value={sampleCount} onChange={(event) => setSampleCount(event.target.value)} /></label>
      <label className="field-group"><span>Interval (ms, minimum 1000)</span><input type="number" min="1000" max="3600000" step="1000" value={intervalMs} onChange={(event) => setIntervalMs(event.target.value)} /></label>
      <details className="simulation-seeds"><summary>Seed unconfigured sensor values</summary><div className="seed-grid">{sensorKeys.map((key) => <label className="field-group" key={key}><span>{key}</span><input type="number" step="any" value={seedValues[key]} onChange={(event) => setSeedValues((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div><p className="form-help">Provide finite values for parameters without configured limits. These are development samples, not real measurements.</p></details>
      <button className="button button-primary" disabled={busy || !waterBodyId}>{busy ? 'Working…' : 'Start simulation'}</button>
    </form>
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="simulation-sessions">{sessions.map((session) => <article className="simulation-session" key={session._id}>
      <div><strong>{session.scenario}</strong><span>{session.status} · {session.samplesGenerated}/{session.sampleCount} accepted · {session.intervalMs} ms interval</span><span>Started {session.startedAt ? new Date(session.startedAt).toLocaleString() : 'time unavailable'}</span>{session.lastError && <small>{session.lastError}</small>}</div>
      {['running', 'stopping'].includes(session.status) && <button className="button button-secondary" disabled={busy} onClick={() => action(session, 'stop')}>Stop</button>}
      <button className="text-link" disabled={busy} onClick={() => action(session, 'delete')}>Delete generated data</button>
    </article>)}</div>
  </section>
}

export default SimulationPanel
