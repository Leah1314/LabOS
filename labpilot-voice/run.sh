#!/usr/bin/env bash
# The launcher VoiceOS invokes (manifest runtime: command "bash", args ["run.sh"]).
#
# This exists for one reason: VoiceOS is a GUI app, and GUI processes on macOS do
# not inherit your shell PATH. If node came from nvm/homebrew, a bare `node` in
# the manifest resolves to nothing and the integration dies at handshake with a
# useless error. So we find a real node ourselves.
set -euo pipefail
cd "$(dirname "$0")"

NODE_BIN="${RF_NODE_BIN:-$(command -v node 2>/dev/null || true)}"

if [ -z "$NODE_BIN" ]; then
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.volta/bin/node \
    /usr/bin/node
  do
    if [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi
  done
fi

if [ -z "$NODE_BIN" ]; then
  # stdout is the MCP wire — diagnostics must go to stderr.
  echo "ResearchFlow: no node binary found. Set RF_NODE_BIN to an absolute path." >&2
  exit 1
fi

exec "$NODE_BIN" server.mjs
