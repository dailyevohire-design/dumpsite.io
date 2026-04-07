#!/bin/bash
# Run Sarah test suite with env vars pre-loaded
cd "$(dirname "$0")/.." || exit 1

# Load env vars safely — skip lines with angle brackets or other shell-breaking chars
while IFS='=' read -r key value; do
  # Skip comments and empty lines
  [[ -z "$key" || "$key" =~ ^# ]] && continue
  # Skip lines with < or > that break shell
  [[ "$value" == *"<"* || "$value" == *">"* ]] && continue
  export "$key=$value"
done < .env.local

exec npx tsx tests/test-sarah.ts "$@"
