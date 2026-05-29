#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Not macOS; skip signing identity discovery."
  exit 0
fi

echo "Discovering macOS code-signing identities..."
security find-identity -v -p codesigning || true

COUNT="$(security find-identity -v -p codesigning | grep -c '")' || true)"
if [[ "${COUNT}" == "0" ]]; then
  echo "No valid signing identity found. electron-builder will create an unsigned macOS artifact."
else
  echo "Found ${COUNT} signing identity candidate(s). electron-builder will auto-discover CSC identity."
fi
