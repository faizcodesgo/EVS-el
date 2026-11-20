import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../services/api'

const initialForm = { name: '', location: '', waterType: 'Pond' }
const parameterFields = [
  { key: 'temperature', label: 'Temperature', unit: '°C' },
  { key: 'pH', label: 'pH', unit: '' },
  { key: 'salinity', label: 'Salinity', unit: 'sensor unit' },
  { key: 'ammonia', label: 'Ammonia (TAN-N)', unit: 'mg/L' }
]

function emptyLimits() {
  return Object.fromEntries(parameterFields.map(({ key }) => [key, { enabled: false, min: '', max: '' }]))
}

function RegisterWaterBody() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  const [form, setForm] = useState(initialForm)
  const [monitoringLimits, setMonitoringLimits] = useState(emptyLimits)
  const [loading, setLoading] = useState(Boolean(editId))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editId) return undefined
    const controller = new AbortController()

    api.get('/water-bodies', { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return
        const body = (response.data.waterBodies || []).find((item) => item._id === editId)
        if (!body) {
          setError('Water body not found in your account.')
          return
        }
        setForm({ name: body.name, location: body.location || '', waterType: body.waterType })
        setMonitoringLimits(Object.fromEntries(parameterFields.map(({ key }) => [key, {
          enabled: Boolean(body.monitoringLimits?.[key]?.enabled),
          min: body.monitoringLimits?.[key]?.min ?? '',
          max: body.monitoringLimits?.[key]?.max ?? ''
        }])))
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          setError(requestError.response?.data?.message || 'Could not load this water body.')
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [editId])

  function handleChange(event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
  }

  function handleLimitChange(key, field, value) {
    setMonitoringLimits((current) => ({
      ...current,
      [key]: { ...current[key], [field]: field === 'enabled' ? value : value }
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    if (!form.name.trim()) {
      setError('Enter a water body name.')
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        name: form.name.trim(),
        location: form.location.trim(),
        waterType: form.waterType,
        monitoringLimits: Object.fromEntries(parameterFields.map(({ key }) => [key, {
          enabled: monitoringLimits[key].enabled,
          ...(monitoringLimits[key].min !== '' && monitoringLimits[key].max !== ''
            ? { min: Number(monitoringLimits[key].min), max: Number(monitoringLimits[key].max) } : {})
        }]))
      }
      if (editId) {
        await api.put(`/water-bodies/${encodeURIComponent(editId)}`, payload)
      } else {
        await api.post('/water-bodies', payload)
      }
      navigate('/water-bodies', {
        state: { notice: editId ? 'Water body details updated.' : 'Water body registered.' }
      })
    } catch (requestError) {
      setError(requestError.response?.data?.message || 'Could not save this water body.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className="page-stack narrow-page">
      <header className="page-heading">
        <div>
          <p className="section-kicker">WATER BODY MANAGEMENT</p>
          <h2>{editId ? 'Edit Water Body' : 'Register Water Body'}</h2>
          <p>Provide the identifying details for the water body you monitor.</p>
        </div>
      </header>

      {loading ? <p className="inline-state">Loading water body…</p> : (
        <form className="form-panel" onSubmit={handleSubmit}>
          <label className="field-label" htmlFor="water-name">Water body name</label>
          <input id="water-name" name="name" value={form.name} onChange={handleChange} required maxLength={100} />

          <label className="field-label" htmlFor="water-location">Location</label>
          <input id="water-location" name="location" value={form.location} onChange={handleChange} placeholder="Optional" />

          <label className="field-label" htmlFor="water-type">Water body type</label>
          <select id="water-type" name="waterType" value={form.waterType} onChange={handleChange} required>
            <option value="Pond">Pond</option>
            <option value="Lake">Lake</option>
            <option value="River">River</option>
            <option value="Fish Farm">Fish Farm</option>
            <option value="Other">Other</option>
          </select>

          <fieldset className="limits-fieldset">
            <legend>User-configured monitoring limits</legend>
            <p className="form-help">Limits are configured by you. HydroGen does not apply default environmental thresholds.</p>
            <p className="form-help">Changes to limits are applied to active alerts when the next valid reading arrives. TAN-N is not un-ionized NH₃; the salinity unit is not established by the sensor contract.</p>
            {parameterFields.map(({ key, label, unit }) => (
              <div className="limit-row" key={key}>
                <label className="limit-enable"><input type="checkbox" checked={monitoringLimits[key].enabled} onChange={(event) => handleLimitChange(key, 'enabled', event.target.checked)} />{label}{unit ? ` (${unit})` : ''}</label>
                <label className="field-group"><span>Minimum</span><input type="number" step="any" value={monitoringLimits[key].min} onChange={(event) => handleLimitChange(key, 'min', event.target.value)} /></label>
                <label className="field-group"><span>Maximum</span><input type="number" step="any" value={monitoringLimits[key].max} onChange={(event) => handleLimitChange(key, 'max', event.target.value)} /></label>
              </div>
            ))}
          </fieldset>

          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="form-actions">
            <button className="button button-primary" type="submit" disabled={submitting}>
              {submitting ? 'Saving…' : editId ? 'Save Changes' : 'Register Water Body'}
            </button>
            <Link className="button button-secondary" to="/water-bodies">Cancel</Link>
          </div>
        </form>
      )}
    </section>
  )
}

export default RegisterWaterBody
