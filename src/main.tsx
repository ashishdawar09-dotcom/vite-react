import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import { ErrorBoundary } from './components/ErrorBoundary'
import { IosInstallHint } from './components/IosInstallHint'
import { LottieLoader } from './components/ui/lottie-loader'
import { ToastProvider, ToastBridge } from './components/Toast'

// Lazy: App (the admin/spectator surface) and the public-only pages are
// route-split so a visitor to /register/:id, /t/:slug, or /p/:id never
// downloads the admin code, and the admin shell isn't blocking the first
// paint on /.
const App = lazy(() => import('./App'))
const PublicRegistrationPage = lazy(() =>
  import('./features/publicRegistration/PublicRegistrationPage').then((m) => ({
    default: m.PublicRegistrationPage,
  })),
)
const PublicSpectatorPage = lazy(() =>
  import('./features/publicSpectator/PublicSpectatorPage').then((m) => ({
    default: m.PublicSpectatorPage,
  })),
)
const VenueTvPage = lazy(() =>
  import('./features/publicSpectator/VenueTvPage').then((m) => ({
    default: m.VenueTvPage,
  })),
)
const ResultsPage = lazy(() =>
  import('./features/publicSpectator/ResultsPage').then((m) => ({
    default: m.ResultsPage,
  })),
)
const PublicPlayerProfilePage = lazy(() =>
  import('./features/publicSpectator/PublicPlayerProfilePage').then((m) => ({
    default: m.PublicPlayerProfilePage,
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
//
// onNeedRefresh fires when a new SW has been installed in the background
// and is waiting to activate. We surface that as a toast so admins running
// a tournament don't unknowingly live on stale JS for hours after a deploy.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    // Dynamic import so the toast module + its motion deps aren't pulled
    // into the initial chunk just for this rarely-fired path.
    void import('./components/Toast').then((m) => {
      m.toast(
        'A new version is available. Reload to update.',
        'info',
      );
    });
    // Auto-activate the new SW in the background. The page itself keeps
    // running on the old JS until the user reloads — which is the safe
    // default during a live tournament. The toast prompts them when ready.
    void updateSW(true);
  },
});

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
              {/* Public share surfaces — anonymous read of tournament state.
                  Specific sub-paths must come BEFORE the bare /t/:slug match. */}
              <Route path="/t/:slug/tv" element={<VenueTvPage />} />
              <Route path="/t/:slug/results" element={<ResultsPage />} />
              <Route path="/t/:slug" element={<PublicSpectatorPage />} />
              <Route path="/p/:id" element={<PublicPlayerProfilePage />} />
              <Route path="*" element={<App />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)
