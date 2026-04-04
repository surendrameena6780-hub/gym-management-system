import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import axios from 'axios'
import './index.css'
import App from './App.jsx'
import { applyInterfacePreferences, loadInterfacePreferencesLocal } from './utils/interfacePreferences'

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

  const method = String(response?.config?.method || 'get').toLowerCase()
  const requestUrl = String(response?.config?.url || '')
  const isMutation = ['post', 'put', 'patch', 'delete'].includes(method)
  const isApiRequest = requestUrl.includes('/api/')
  const shouldBroadcastDataChange = isMutation
    && isApiRequest
    && !requestUrl.includes('/api/auth')
    && !requestUrl.includes('/api/superadmin')
    && !requestUrl.includes('/api/push/subscribe')

  if (typeof window !== 'undefined' && shouldBroadcastDataChange) {
    window.dispatchEvent(new CustomEvent('gymvault:data-changed', {
      detail: {
        source: `axios:${method}`,
        url: requestUrl,
        at: Date.now(),
      },
    }))
  }

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

applyInterfacePreferences(loadInterfacePreferencesLocal())

if (typeof window !== 'undefined' && !window.__gymvaultViewportSyncInstalled) {
  window.__gymvaultViewportSyncInstalled = true

  const getLayoutViewportHeight = () => Math.max(
    Math.round(window.innerHeight || 0),
    Math.round(document.documentElement.clientHeight || 0),
  )

  let stableViewportHeight = getLayoutViewportHeight()
  let lastViewportWidth = Math.round(
    window.visualViewport?.width || window.innerWidth || document.documentElement.clientWidth || 0,
  )
  const KEYBOARD_OPEN_THRESHOLD_PX = 120

  const syncViewportVariables = () => {
    const layoutHeight = getLayoutViewportHeight()
    const viewport = window.visualViewport
    const visibleHeight = viewport ? Math.round(viewport.height || 0) : layoutHeight
    const currentWidth = Math.round(
      viewport?.width || window.innerWidth || document.documentElement.clientWidth || 0,
    )
    const widthChanged = Math.abs(currentWidth - lastViewportWidth) > 48
    if (currentWidth > 0) lastViewportWidth = currentWidth

    const inferredKeyboardInset = Math.max(0, layoutHeight - visibleHeight)
    const isKeyboardOpen = !widthChanged && inferredKeyboardInset > KEYBOARD_OPEN_THRESHOLD_PX

    // Track the layout viewport height (innerHeight) — NOT the visual viewport.
    // On Safari, visualViewport.height is smaller when the toolbar is visible,
    // but innerHeight matches the CSS layout viewport that fixed elements use.
    if (!isKeyboardOpen && layoutHeight > 0) {
      stableViewportHeight = layoutHeight
    }

    if (stableViewportHeight > 0) {
      document.documentElement.style.setProperty('--app-viewport-height', `${stableViewportHeight}px`)
    }

    document.documentElement.style.setProperty('--app-keyboard-inset', `${isKeyboardOpen ? inferredKeyboardInset : 0}px`)
    document.documentElement.classList.toggle('app-keyboard-open', isKeyboardOpen)
  }

  let rafId = 0
  const queueViewportSync = () => {
    if (rafId) return
    rafId = window.requestAnimationFrame(() => {
      rafId = 0
      syncViewportVariables()
    })
  }

  syncViewportVariables()
  window.addEventListener('resize', queueViewportSync, { passive: true })
  window.addEventListener('orientationchange', queueViewportSync, { passive: true })
  window.visualViewport?.addEventListener('resize', queueViewportSync, { passive: true })
  window.visualViewport?.addEventListener('scroll', queueViewportSync, { passive: true })
}

if (typeof window !== 'undefined' && !window.__gymvaultTouchGuardsInstalled) {
  window.__gymvaultTouchGuardsInstalled = true

  const blockZoomGesture = (event) => {
    event.preventDefault()
  }

  document.addEventListener('gesturestart', blockZoomGesture, { passive: false })
  document.addEventListener('gesturechange', blockZoomGesture, { passive: false })
  document.addEventListener('gestureend', blockZoomGesture, { passive: false })
  document.addEventListener('dblclick', blockZoomGesture, { passive: false })

  const nestedScrollableSelector = '.payments-mobile-list-scroll, .members-mobile-list-scroll'
  const nestedScrollState = {
    activeElement: null,
    lastY: 0,
    outerElement: null,
    outerPreviousOverflowY: '',
    outerLocked: false,
  }

  const unlockOuterScroll = () => {
    const outer = nestedScrollState.outerElement
    if (!outer) return

    outer.style.overflowY = nestedScrollState.outerPreviousOverflowY || ''
    nestedScrollState.outerElement = null
    nestedScrollState.outerPreviousOverflowY = ''
  }

  const lockOuterScroll = (scrollable) => {
    const outer = scrollable.closest('main.app-scroll-shell') || document.querySelector('main.app-scroll-shell')
    if (!outer) return

    if (nestedScrollState.outerElement && nestedScrollState.outerElement !== outer) {
      unlockOuterScroll()
    }

    if (!nestedScrollState.outerElement) {
      nestedScrollState.outerElement = outer
      nestedScrollState.outerPreviousOverflowY = outer.style.overflowY || ''
      outer.style.overflowY = 'hidden'
    }
  }

  const resetNestedScrollState = () => {
    nestedScrollState.activeElement = null
    nestedScrollState.lastY = 0
    nestedScrollState.outerLocked = false
    unlockOuterScroll()
  }

  const getNestedScrollable = (target) => {
    if (!target || typeof target.closest !== 'function') return null
    return target.closest(nestedScrollableSelector)
  }

  document.addEventListener('touchstart', (event) => {
    const scrollable = getNestedScrollable(event.target)
    if (!scrollable) {
      resetNestedScrollState()
      return
    }

    const canScroll = scrollable.scrollHeight > scrollable.clientHeight + 1
    if (!canScroll) {
      resetNestedScrollState()
      return
    }

    lockOuterScroll(scrollable)
    nestedScrollState.activeElement = scrollable
    nestedScrollState.lastY = event.touches?.[0]?.clientY || 0
    nestedScrollState.outerLocked = true
  }, { passive: true, capture: true })

  document.addEventListener('touchmove', (event) => {
    const scrollable = nestedScrollState.activeElement
    if (!scrollable) return

    const currentY = event.touches?.[0]?.clientY
    if (typeof currentY !== 'number') return

    const deltaY = currentY - nestedScrollState.lastY
    nestedScrollState.lastY = currentY

    const atTop = scrollable.scrollTop <= 0
    const atBottom = scrollable.scrollTop + scrollable.clientHeight >= scrollable.scrollHeight - 1
    const isOverscrolling = (atTop && deltaY > 0) || (atBottom && deltaY < 0)

    if (isOverscrolling) {
      resetNestedScrollState()
      return
    }

  }, { passive: false, capture: true })

  const clearNestedScrollState = () => {
    resetNestedScrollState()
  }

  document.addEventListener('touchend', clearNestedScrollState, { passive: true, capture: true })
  document.addEventListener('touchcancel', clearNestedScrollState, { passive: true, capture: true })
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
