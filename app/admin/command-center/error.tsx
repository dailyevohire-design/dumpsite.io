"use client"
import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"

export default function CommandCenterError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { route: "admin/command-center", boundary: "segment" },
      extra: { digest: error.digest },
    })
  }, [error])

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0a0a",
      color: "#F0EDE8",
      padding: 32,
      fontFamily: "ui-sans-serif, system-ui",
    }}>
      <div style={{ maxWidth: 720, margin: "60px auto", background: "#181818", border: "1px solid #2a2a2a", borderRadius: 8, padding: 32 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>
          Command center hit a render error
        </h2>
        <p style={{ marginTop: 12, color: "#9a9a9a", fontSize: 14 }}>
          The error has been captured in Sentry. You can retry, or refresh the page.
        </p>
        <pre style={{
          marginTop: 16,
          padding: 12,
          background: "#0a0a0a",
          border: "1px solid #2a2a2a",
          borderRadius: 4,
          fontSize: 12,
          color: "#c0c0c0",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {error.message || "(no message)"}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <button
          onClick={reset}
          style={{
            marginTop: 16,
            padding: "8px 16px",
            background: "#2a2a2a",
            color: "#F0EDE8",
            border: "1px solid #3a3a3a",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
