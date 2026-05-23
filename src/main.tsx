import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { IosInstallHint } from './components/IosInstallHint'
import { LottieLoader } from './components/ui/lottie-loader'
import { ToastProvider, ToastBridge } from './components/Toast'

// Lazy: App (the admin/spectator surface) and PublicRegistrationPage are
// route-split so a visitor to /register/:id never downloads the admin code,
// and the admin shell isn't blocking the first paint on /.
const App = lazy(() => import('./App'))
const PublicRegistrationPage = lazy(() =>
  import('./features/publicRegistration/PublicRegistrationPage').then((m) => ({
    default: m.PublicRegistrationPage,
  })),
)

// Sentry deferred to idle — its bundle (~80 KB) shouldn't block first paint.
// Errors during the first ~100ms of boot are rare; the cost-benefit favors
// shipping the rest of the app sooner.
function deferSentryInit() {
  const run = async () => {
    const { initSentry } = await import('./lib/sentry')
    initSentry()
  }
  // requestIdleCallback isn't in TypeScript's lib.dom types in all configs;
  // fall back to setTimeout for Safari (which doesn't ship it yet either).
  type IdleAPI = (cb: () => void) => void
  const ric = (window as unknown as { requestIdleCallback?: IdleAPI }).requestIdleCallback
  if (typeof ric === 'function') ric(() => { void run() })
  else setTimeout(() => { void run() }, 1500)
}
deferSentryInit()

// PWA: register the auto-generated service worker. `immediate: true` means
// a new SW takes control on the next visit without forcing a refresh.
// In dev mode (`vite`) this is a no-op — only runs after `vite build`.
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <ToastBridge />
        <BrowserRouter>
          <IosInstallHint />
          <Suspense fallback={<LottieLoader fullScreen label="Loading…" />}>
            <Routes>
              <Route path="/register/:tournamentId" element={<PublicRegistrationPage />} />
              <Route path="*" element={<App />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)
