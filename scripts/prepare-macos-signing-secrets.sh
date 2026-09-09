#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/prepare-macos-signing-secrets.sh /path/to/DeveloperIDApplication.p12 [certificate-base64.txt]

This helper converts an exported Developer ID Application .p12 certificate to
the APPLE_CERTIFICATE GitHub secret format used as Electron Builder CSC_LINK.

It does not upload secrets automatically.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

p12_path="${1:-}"
out_path="${2:-certificate-base64.txt}"

if [ -z "$p12_path" ]; then
  usage
  exit 1
fi

if [ ! -f "$p12_path" ]; then
  echo "ERROR: .p12 file not found: $p12_path" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required." >&2
  exit 1
fi

openssl base64 -A -in "$p12_path" -out "$out_path"

cat <<EOF
Wrote: $out_path

Create or update the GitHub Secrets with:

  gh secret set APPLE_CERTIFICATE < "$out_path"
  gh secret set APPLE_CERTIFICATE_PASSWORD --body "<password used when exporting the .p12>"
  gh secret set APPLE_ID --body "<your Apple ID email>"
  gh secret set APPLE_PASSWORD --body "<Apple app-specific password>"
  gh secret set APPLE_TEAM_ID --body "<your Apple Team ID>"

Keep "$out_path" and the .p12 file private. The default
certificate-base64.txt path and .p12 files are ignored by this repo's
.gitignore. If you passed a custom output path, make sure it is also kept out
of git. Delete or archive the signing files securely after setting the secrets.
EOF
