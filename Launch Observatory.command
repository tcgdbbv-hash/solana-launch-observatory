#!/bin/zsh
# Finder opens executable .command files in Terminal.
emulate -LR zsh
setopt NO_NOMATCH
cd -- "${0:A:h}" || exit 1

# Finder may not inherit the Node installation used by your normal terminal.
# Prefer the current runtime, then common macOS and version-manager locations.
typeset -a candidates
candidates=(
  "${commands[node]:-}"
  /opt/homebrew/bin/node
  /usr/local/bin/node
  "$HOME"/.nvm/versions/node/*/bin/node(NOn)
  "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node(NOn)
  "$HOME"/.volta/bin/node
)
for runtime in "${candidates[@]}"; do
  [[ -x "$runtime" ]] || continue
  if "$runtime" -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 24 || (major === 24 && minor >= 10) ? 0 : 1)' 2>/dev/null; then
    export PATH="${runtime:h}:$PATH"
    exec "$runtime" scripts/launch.mjs "$@"
  fi
done

print -u2 'Observatory needs Node.js 24.10 or later. Install it, then double-click this file again.'
if [[ -t 0 ]]; then
  read -r '?Press Return to close this window.'
fi
exit 1
