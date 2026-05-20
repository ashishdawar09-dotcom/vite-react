import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastProvider, ToastBridge } from './components/Toast'
import { PublicRegistrationPage } from './features/publicRegistration/PublicRegistrationPage'
import { initSentry } from './lib/sentry'

// Initialize Sentry as early as possible so errors during the first render
// are also captured. No-op when VITE_SENTRY_DSN is unset.
initSentry();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <ToastBridge />
        <BrowserRouter>
          <Routes>
            <Route path="/register/:tournamentId" element={<PublicRegistrationPage />} />
            <Route path="*" element={<App />} />
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>,
)
