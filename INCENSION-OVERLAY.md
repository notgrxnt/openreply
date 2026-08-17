# The Incension overlay contract

This fork tracks a fast-moving upstream. In a single afternoon of setup, upstream
shipped SMTP support, PWA icons, a non-Latin keyword fix, and a docs correction —
and one of those rewrote `lib/auth.ts` out from under a patch that was an hour old.

That is the whole reason this file exists.

## The rule

**Upstream owns its files. We add new ones.**

Every file that exists in `diwenne/openreply` is upstream's. Changing one means
resolving a conflict by hand every time upstream touches it again — forever, and
at the worst possible moment, which is when you are mid-launch and want a bug fix.

Everything Incension-specific goes in **new files** — ideally under `incension/`,
or as new routes, new components, new scripts. New files never conflict. Upstream
can rewrite half the app and a new file just keeps working.

## The frozen overlay

Exactly seven upstream files carry Incension changes. This list does not grow.

| File | Why it had to be upstream's file |
|---|---|
| `app/globals.css` | The theme token block. Branding has to live where the tokens are. |
| `app/layout.tsx` | Page title. |
| `components/sidebar.tsx` | Wordmark. |
| `components/legal-shell.tsx` | Wordmark. |
| `components/public-site-header.tsx` | Wordmark. |
| `lib/auth.ts` | Branded magic-link email + the per-recipient token secret. |
| `CLAUDE.md` | Points agents at this file. |
| `lib/queue/dm-worker.ts` | Attribution hook — mints the token when a DM is sent. |
| `lib/tracking/message.ts` | Attribution hook — appends `?t=` to tracked links. |
| `app/r/[slug]/route.ts` | Attribution hook — records the token on the click. |
| `prisma/schema.prisma` | `LinkClick.recipientToken` column + opening-DM default. |
| `__tests__/dm-worker.test.ts` | Two assertions updated to the new URL contract. |
| `__tests__/redirect.test.ts` | Tests for the attribution behaviour. |

The attribution logic itself is **one new file** — `lib/tracking/recipient-token.ts`.
The six entries above are only the call sites it hooks into: a worker cannot be
extended from outside itself, and a Prisma column cannot live in another schema.

**A note on how this list was written.** The first draft of this file claimed the
overlay was seven files. Then `scripts/check-overlay.sh` ran and found thirteen.
The prose was optimistic; the script was correct. That is the argument for
mechanical enforcement over good intentions, and it is why this rule is a CI job
rather than a paragraph.

**Adding to this table is a decision, not a convenience.** Each new entry is a
merge conflict you have agreed to resolve for the life of the fork.

## What to do instead

| You want to… | Do this |
|---|---|
| Change how something looks | Edit tokens in `app/globals.css` — already overlaid |
| Add a page or dashboard view | New route under `app/` |
| Add CRM / attribution / sync logic | New module under `incension/` |
| Change worker behaviour | New module, called from the smallest possible hook |
| Add an integration | New API route + new lib file |

## Enforcement

`scripts/check-overlay.sh` compares this branch against `upstream/main` and fails
if any upstream file outside the frozen list was modified. It runs in CI on every
push and pull request via `.github/workflows/overlay-guard.yml`.

Run it locally before pushing:

```bash
bash scripts/check-overlay.sh
```

## Pulling upstream updates

```bash
git remote add upstream https://github.com/diwenne/openreply.git   # once
git fetch upstream
git merge upstream/main
```

If the overlay stays this small, that merge is uneventful — which is the entire
point. The moment it stops being uneventful, someone edited a file they should
have left alone.
