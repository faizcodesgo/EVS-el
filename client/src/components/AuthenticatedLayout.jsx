import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity,
  Bell,
  Cpu,
  Info,
  Menu,
  PlusSquare,
  Waves,
  X
} from 'lucide-react'
import api from '../services/api'

const navigation = [
  { label: 'Water Quality', to: '/water-quality', icon: Activity },
  { label: 'My Water Bodies', to: '/water-bodies', icon: Waves },
  { label: 'Register Water Body', to: '/water-bodies/register', icon: PlusSquare },
  { label: 'Register Device', to: '/devices/register', icon: Cpu },
  { label: 'Alerts', to: '/alerts', icon: Bell },
  { label: 'About Us', to: '/about', icon: Info }
]

function getPageTitle(pathname) {
  if (pathname.startsWith('/water-bodies/register')) return 'Register Water Body'
  if (pathname.startsWith('/devices/register')) return 'Register Device'
  if (pathname.startsWith('/water-bodies')) return 'My Water Bodies'
  if (pathname.startsWith('/about')) return 'About Us'
  if (pathname.startsWith('/alerts')) return 'Alerts'
  return 'Water Quality'
}

function AuthenticatedLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [logoutError, setLogoutError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    api.get('/auth/me', { signal: controller.signal })
      .then((response) => {
        if (!controller.signal.aborted) setUser(response.data.user)
      })
      .catch(() => {
        if (!controller.signal.aborted) navigate('/', { replace: true })
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [navigate])

  useEffect(() => {
    if (!mobileOpen) return undefined
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [mobileOpen])

  async function handleLogout() {
    setLogoutError('')
    try {
      await api.post('/auth/logout')
      navigate('/', { replace: true })
    } catch {
      setLogoutError('Logout failed. Please try again.')
    }
  }

  if (loading) {
    return <main className="auth-check">Checking your HydroGen session…</main>
  }
  if (!user) return null

  return (
    <div className="app-shell">
      <button
        className="mobile-menu-toggle"
        type="button"
        aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
        aria-expanded={mobileOpen}
        onClick={() => setMobileOpen((open) => !open)}
      >
        {mobileOpen ? <X size={21} /> : <Menu size={21} />}
      </button>
      {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}

      <aside className={`app-sidebar${mobileOpen ? ' app-sidebar-open' : ''}`}>
        <NavLink className="sidebar-brand" to="/water-quality" aria-label="HydroGen Water Quality">
          <span className="sidebar-wordmark">HydroGen</span>
        </NavLink>

        <nav className="sidebar-navigation" aria-label="Main navigation">
          {navigation.map(({ label, to, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link-active' : ''}`}
              onClick={() => setMobileOpen(false)}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-account">
          {logoutError && <p className="sidebar-error" role="alert">{logoutError}</p>}
          <div className="sidebar-user">
            {user.picture
              ? <img className="sidebar-avatar" src={user.picture} alt="" />
              : <span className="sidebar-avatar sidebar-avatar-fallback" aria-hidden="true">{user.name?.[0] || 'U'}</span>}
            <span className="sidebar-user-name">{user.name}</span>
          </div>
          <button className="sidebar-logout" type="button" onClick={handleLogout}>Log out</button>
        </div>
      </aside>

      <div className="app-workspace">
        <header className="workspace-topbar">
          <div>
            <p className="workspace-breadcrumb">HydroGen / {getPageTitle(location.pathname)}</p>
            <h1>{getPageTitle(location.pathname)}</h1>
          </div>
          <div className="workspace-profile">
            {user.picture && <img src={user.picture} alt="" />}
            <span>{user.name}</span>
          </div>
        </header>
        <main className="workspace-content">
          <Outlet context={{ user }} />
        </main>
      </div>
    </div>
  )
}

export default AuthenticatedLayout
