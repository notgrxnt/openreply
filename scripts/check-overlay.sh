#!/usr/bin/env bash
#
# Overlay guard — see INCENSION-OVERLAY.md
#
# Fails if this branch modifies an upstream-owned file that isn't on the frozen
# overlay list. New files are always allowed: they can't conflict with upstream.
#
#   bash scripts/check-overlay.sh
#
set -euo pipefail

UPSTREAM_URL="${UPSTREAM_URL:-https://github.com/diwenne/openreply.git}"
UPSTREAM_REF="${UPSTREAM_REF:-upstream/main}"

# The frozen overlay. Adding a line here is a decision — every entry is a merge
# conflict you have agreed to resolve for the life of the fork.
ALLOWED=(
  "app/globals.css"
  "app/layout.tsx"
  "components/sidebar.tsx"
  "components/legal-shell.tsx"
  "components/public-site-header.tsx"
  "lib/auth.ts"
  "CLAUDE.md"

  # Per-recipient attribution. The token itself is a new file
  # (lib/tracking/recipient-token.ts); these are the call sites it hooks into.
  # A worker cannot be extended from outside itself.
  "lib/queue/dm-worker.ts"
  "lib/tracking/message.ts"
  "app/r/[slug]/route.ts"
  "prisma/schema.prisma"
  "__tests__/dm-worker.test.ts"
  "__tests__/redirect.test.ts"
)

if ! git remote get-url upstream >/dev/null 2>&1; then
  git remote add upstream "$UPSTREAM_URL"
fi
git fetch --quiet upstream main

merge_base="$(git merge-base HEAD "$UPSTREAM_REF")"

# Files this branch changed relative to where it diverged from upstream.
changed="$(git diff --name-only "$merge_base" HEAD)"

violations=()

while IFS= read -r file; do
  [ -z "$file" ] && continue

  # New file? Upstream doesn't have it, so it cannot conflict. Always fine.
  if ! git cat-file -e "$UPSTREAM_REF:$file" 2>/dev/null; then
    continue
  fi

  allowed=false
  for ok in "${ALLOWED[@]}"; do
    if [ "$file" = "$ok" ]; then allowed=true; break; fi
  done

  $allowed || violations+=("$file")
done <<< "$changed"

if [ ${#violations[@]} -gt 0 ]; then
  echo ""
  echo "✗ Overlay violation — these upstream-owned files were modified:"
  printf '    %s\n' "${violations[@]}"
  echo ""
  echo "  Upstream owns its files. Put Incension logic in NEW files instead —"
  echo "  ideally under incension/. New files never conflict on merge."
  echo ""
  echo "  If a change genuinely cannot live in a new file, add the path to"
  echo "  ALLOWED in this script AND to the table in INCENSION-OVERLAY.md, so"
  echo "  the cost is visible to whoever merges upstream next."
  echo ""
  exit 1
fi

echo "✓ Overlay clean — no upstream files modified outside the frozen list."
