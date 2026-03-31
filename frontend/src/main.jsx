import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'

const unwrapApiData = (payload) => {
  let current = payload
  let guard = 0

  while (
    current &&
    typeof current === 'object' &&
    !Array.isArray(current) &&
    !(current instanceof Date) &&
    Object.prototype.hasOwnProperty.call(current, 'data') &&
    guard < 8
  ) {
    current = current.data
    guard += 1
  }

  return current
}

const configuredApiUrl = String(import.meta.env.VITE_API_URL || '').trim()
const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)
const apiBaseUrl = configuredApiUrl || (isLocalHost ? 'http://localhost:5000' : '')
axios.defaults.baseURL = apiBaseUrl

axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token && config.headers && !config.headers['x-auth-token'] && !config.headers.Authorization) {
    config.headers['x-auth-token'] = token
  }

  return config
})

axios.interceptors.response.use((response) => {
  response.data = unwrapApiData(response.data)
  return response
}, (error) => {
  const status = error?.response?.status
  const code = error?.response?.data?.code
  const requestUrl = String(error?.config?.url || '')
  const pathname = typeof window !== 'undefined' ? String(window.location.pathname || '') : ''
  const normalizedPath = pathname.replace(/\/+$/, '') || '/'
  const isHQPath = normalizedPath === '/hq-admin' || normalizedPath.startsWith('/hq-admin/')
  const reqHeaders = error?.config?.headers || {}
  const isSuperadminReq = Boolean(reqHeaders['x-super-token'])
  const isSuperadminUrl = requestUrl.includes('/api/superadmin')

  if (status === 401 && !isHQPath && !isSuperadminReq && !isSuperadminUrl && (code === 'AUTH_INVALID' || code === 'AUTH_MISSING')) {
    localStorage.removeItem('token')
    window.dispatchEvent(new CustomEvent('gymvault:auth-invalid', {
      detail: {
        message: error?.response?.data?.error || 'Session expired. Please login again.'
      }
    }))
  }

  return Promise.reject(error)
})

if (typeof document !== 'undefined') {
  const blockZoomGesture = (event) => {
    event.preventDefault()
  }

  document.addEventListener('gesturestart', blockZoomGesture, { passive: false })
  document.addEventListener('gesturechange', blockZoomGesture, { passive: false })
  document.addEventListener('gestureend', blockZoomGesture, { passive: false })
  document.addEventListener('dblclick', blockZoomGesture, { passive: false })
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error)
    })
  })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
