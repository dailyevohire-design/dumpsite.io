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
        <p className="text-sm text-gray-400">
          An unexpected error occurred loading this view.
        </p>
        {error.digest ? (
          <button
            onClick={() => navigator.clipboard.writeText(error.digest!)}
            className="mt-2 text-xs text-gray-500 hover:text-gray-300 underline"
            aria-label="Copy error reference for support"
          >
            Reference: {error.digest} (click to copy)
          </button>
        ) : null}
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
        {process.env.NODE_ENV !== "production" && error.message ? (
          <pre className="mt-4 text-xs text-red-400 whitespace-pre-wrap">
            {error.message}
          </pre>
        ) : null}
      </div>
    </div>
  )
}
