import React from "react";
import { captureError } from "../lib/sentry";

type Props = { children: React.ReactNode; fallback?: React.ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary]", error, info.componentStack);
    // Forward to Sentry (no-op when VITE_SENTRY_DSN isn't set).
    captureError(error, { componentStack: info.componentStack });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;
    return (
      <div
        style={{
          // dvh = dynamic viewport height — correct for iOS PWA where vh
          // includes safe-area zones. Safari 15.4+/iOS 17 all support it.
          minHeight: "100dvh",
          background: "#0a1628",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "max(env(safe-area-inset-top, 0px), 24px) 24px max(env(safe-area-inset-bottom, 0px), 24px)",
        }}
      >
        <div
          style={{
            maxWidth: 520,
            background: "#0f1e36",
            border: "1px solid #1a3050",
            borderRadius: 14,
            padding: 32,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h2 className="font-display" style={{ margin: "0 0 12px", fontSize: 22, letterSpacing: 1, color: "#ef4444" }}>
            SOMETHING WENT WRONG
          </h2>
          <p style={{ color: "#94a3b8", fontSize: 14, lineHeight: 1.5, margin: "0 0 20px" }}>
            The page hit an unexpected error. Your data is safe — just reload to continue.
          </p>
          <pre
            style={{
              textAlign: "left",
              fontSize: 11,
              background: "#0a1628",
              color: "#fbbf24",
              padding: 10,
              borderRadius: 6,
              overflow: "auto",
              maxHeight: 160,
              border: "1px solid #1a3050",
            }}
          >
            {this.state.error.message}
          </pre>
          <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 20 }}>
            <button
              onClick={() => window.location.reload()}
              className="font-display"
              style={{
                padding: "10px 20px",
                borderRadius: 6,
                border: "1px solid #00d4ff",
                background: "#00d4ff",
                color: "#0a1628",
                fontWeight: 800,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              RELOAD
            </button>
            <button
              onClick={this.reset}
              className="font-display"
              style={{
                padding: "10px 20px",
                borderRadius: 6,
                border: "1px solid #1a3050",
                background: "transparent",
                color: "#94a3b8",
                fontWeight: 700,
                letterSpacing: 1,
                cursor: "pointer",
              }}
            >
              DISMISS
            </button>
          </div>
        </div>
      </div>
    );
  }
}
