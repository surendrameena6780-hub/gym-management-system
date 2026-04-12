import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import axios from 'axios'
import './index.css'
import App from './App.jsx'
import { clearSessionToken, getSessionToken } from './utils/authSession'
import { applyInterfacePreferences, loadInterfacePreferencesLocal } from './utils/interfacePreferences'
import { getApiOrigin } from './utils/apiUrl'

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

const apiBaseUrl = getApiOrigin()
axios.defaults.baseURL = apiBaseUrl
axios.defaults.withCredentials = true

const emitGlobalApiError = (message, details = {}) => {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent('gymvault:api-error', {
    detail: {
      message,
      ...details,
    },
  }))
}

axios.interceptors.request.use((config) => {
  const token = getSessionToken()
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
  const responseMessage = error?.response?.data?.error || error?.response?.data?.message || ''
  const requestUrl = String(error?.config?.url || '')
  const pathname = typeof window !== 'undefined' ? String(window.location.pathname || '') : ''
  const normalizedPath = pathname.replace(/\/+$/, '') || '/'
  const isHQPath = normalizedPath === '/hq-admin' || normalizedPath.startsWith('/hq-admin/')
  const reqHeaders = error?.config?.headers || {}
  const isSuperadminReq = Boolean(reqHeaders['x-super-token'])
  const isSuperadminUrl = requestUrl.includes('/api/superadmin')
  const isAuthRequest = requestUrl.includes('/api/auth') || requestUrl.includes('/api/superadmin')
  const isNetworkFailure = !error?.response
  const shouldEmitGlobalError = !isAuthRequest
    && !requestUrl.includes('/api/push/subscribe')
    && !error?.config?.suppressGlobalErrorToast

  if (status === 401 && !isHQPath && !isSuperadminReq && !isSuperadminUrl && (code === 'AUTH_INVALID' || code === 'AUTH_MISSING')) {
    clearSessionToken()
    window.dispatchEvent(new CustomEvent('gymvault:auth-invalid', {
      detail: {
        message: responseMessage || 'Session expired. Please login again.'
      }
    }))
  }

  if (shouldEmitGlobalError && (isNetworkFailure || status === 429 || status >= 500)) {
    const message = responseMessage
      || (status === 429
        ? 'Too many requests right now. Please wait a moment and try again.'
        : 'The server is temporarily unavailable. Please try again.')

    emitGlobalApiError(message, {
      status: status || 0,
      url: requestUrl,
    })
  }

  return Promise.reject(error)
})

applyInterfacePreferences(loadInterfacePreferencesLocal())

if (typeof window !== 'undefined' && !window.__gymvaultViewportSyncInstalled) {
  window.__gymvaultViewportSyncInstalled = true

  let stableViewportHeight = Math.max(
    Math.round(window.innerHeight || 0),
    Math.round(document.documentElement.clientHeight || 0),
  )
  const KEYBOARD_OPEN_THRESHOLD_PX = 120

  const isEditableElement = (element) => {
    if (!(element instanceof HTMLElement)) {
      return false
    }

    if (element.isContentEditable) {
      return true
    }

    if (['TEXTAREA', 'SELECT'].includes(element.tagName)) {
      return true
    }

    if (element.tagName !== 'INPUT') {
      return false
    }

    const inputType = String(element.getAttribute('type') || element.type || '').trim().toLowerCase()
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(inputType)
  }

  const syncViewportVariables = () => {
    const viewport = window.visualViewport
    const layoutViewportHeight = Math.max(
      Math.round(window.innerHeight || 0),
      Math.round(document.documentElement.clientHeight || 0),
    )
    const visibleViewportHeight = Math.round(viewport?.height || layoutViewportHeight || 0)
    const viewportOffsetTop = Math.round(viewport?.offsetTop || 0)
    const inferredKeyboardInset = Math.max(0, layoutViewportHeight - visibleViewportHeight - viewportOffsetTop)
    const isKeyboardOpen = isEditableElement(document.activeElement) && inferredKeyboardInset > KEYBOARD_OPEN_THRESHOLD_PX

    if (isKeyboardOpen) {
      // Keyboard is open: lock --app-viewport-height to a stable px so the
      // shell doesn't reflow when the virtual keyboard shifts the viewport.
      if (!isKeyboardOpen && layoutViewportHeight > 0) {
        stableViewportHeight = layoutViewportHeight
      } else if (stableViewportHeight <= 0 && layoutViewportHeight > 0) {
        stableViewportHeight = layoutViewportHeight
      }
      const lockedHeight = Math.max(stableViewportHeight, layoutViewportHeight)
      if (lockedHeight > 0) {
        document.documentElement.style.setProperty('--app-viewport-height', `${lockedHeight}px`)
      }
    } else {
      // Keyboard is NOT open: remove the JS override and let CSS 100dvh be
      // the source of truth. On iOS standalone PWA, 100dvh is computed by
      // WebKit's layout engine and is always correct. window.innerHeight is
      // NOT — it reports a transient wrong value during app resume / after
      // Razorpay, which is the root cause of the layout shift bugs.
      document.documentElement.style.removeProperty('--app-viewport-height')
      stableViewportHeight = layoutViewportHeight
    }

    document.documentElement.style.setProperty('--app-keyboard-inset', `${isKeyboardOpen ? inferredKeyboardInset : 0}px`)
    document.documentElement.classList.toggle('app-keyboard-open', isKeyboardOpen)
  }

  let rafId = 0
  let resumeSyncTimeoutId = 0
  const queueViewportSync = () => {
    if (rafId) return
    rafId = window.requestAnimationFrame(() => {
      rafId = 0
      syncViewportVariables()
    })
  }

  const handleForcedViewportSync = () => {
    queueViewportSync()
    window.setTimeout(() => {
      queueViewportSync()
    }, 180)
  }

  let resumeLateTimeoutId = 0
  const notifyAppResumed = (source) => {
    // Reset document scroll to 0 immediately — the document must not be
    // scrolled in a position:fixed shell app. Razorpay and iOS resume can
    // leave a non-zero scroll position that shifts all fixed elements.
    window.scrollTo(0, 0)
    document.documentElement.scrollTop = 0
    document.body.scrollTop = 0
    queueViewportSync()
    if (resumeSyncTimeoutId) {
      window.clearTimeout(resumeSyncTimeoutId)
    }
    if (resumeLateTimeoutId) {
      window.clearTimeout(resumeLateTimeoutId)
    }
    resumeSyncTimeoutId = window.setTimeout(() => {
      queueViewportSync()
    }, 120)
    // iOS Safari can take 300ms+ to stabilise the viewport after returning
    // from a third-party app (e.g. Razorpay payment redirect)
    resumeLateTimeoutId = window.setTimeout(() => {
      queueViewportSync()
    }, 380)
    window.dispatchEvent(new CustomEvent('gymvault:app-resumed', {
      detail: {
        source,
        at: Date.now(),
      },
    }))
  }

  const handleVisibilityResume = () => {
    if (document.visibilityState === 'visible') {
      notifyAppResumed('visibilitychange')
    }
  }

  syncViewportVariables()
  window.addEventListener('resize', queueViewportSync, { passive: true })
  window.addEventListener('orientationchange', queueViewportSync, { passive: true })
  window.addEventListener('focus', () => notifyAppResumed('focus'), { passive: true })
  window.addEventListener('pageshow', () => notifyAppResumed('pageshow'), { passive: true })
  window.addEventListener('gymvault:force-viewport-sync', handleForcedViewportSync, { passive: true })
  document.addEventListener('visibilitychange', handleVisibilityResume, { passive: true })
  document.addEventListener('focusin', handleForcedViewportSync)
  document.addEventListener('focusout', handleForcedViewportSync)
  window.visualViewport?.addEventListener('resize', queueViewportSync, { passive: true })
  window.visualViewport?.addEventListener('scroll', queueViewportSync, { passive: true })
}

if ('serviceWorker' in navigator) {
  const SERVICE_WORKER_URL = '/sw.js?v=20260411-1'
  let isReloadingForServiceWorker = false

  const reloadForUpdatedServiceWorker = () => {
    if (isReloadingForServiceWorker) {
      return
    }

    isReloadingForServiceWorker = true
    window.location.reload()
  }

  const watchServiceWorkerInstallation = (worker) => {
    if (!worker) {
      return
    }

    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        reloadForUpdatedServiceWorker()
      }
    })
  }

  const refreshServiceWorker = () => {
    navigator.serviceWorker.getRegistration().then((registration) => {
      registration?.update().catch(() => undefined)
    }).catch(() => undefined)
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker.register(SERVICE_WORKER_URL, { updateViaCache: 'none' }).then((registration) => {
      watchServiceWorkerInstallation(registration.installing)
      registration.addEventListener('updatefound', () => {
        watchServiceWorkerInstallation(registration.installing)
      })
      registration.update().catch(() => undefined)
    }).catch((error) => {
      console.warn('Service worker registration failed:', error)
    })
  })

  navigator.serviceWorker.addEventListener('controllerchange', reloadForUpdatedServiceWorker)

  window.addEventListener('focus', refreshServiceWorker, { passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshServiceWorker()
    }
  }, { passive: true })
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <Analytics />
  </StrictMode>,
)
