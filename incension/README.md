# incension/

Incension Health-specific logic. **Everything in this folder is a new file.**

Per `INCENSION-OVERLAY.md`: upstream owns its files, we add new ones. New files
never conflict, so anything that can live here should. The overlay guard allows
this folder unconditionally — it only fails on *modified upstream files*.

## sync/

Pushes comment → DM → click data into the Incension Health Supabase project,
which is the system of record for the whole customer journey (reel → comment →
DM → click → lead → quiz → webinar → sale).

Why push rather than have Supabase pull:

- It is what the overlay contract prescribes for CRM/attribution logic.
- No new files inside upstream's tree, and no modified ones — zero merge cost.
- The OpenReply database never needs to be exposed to the internet.
- **It reuses `recipientToken()` directly.** A pull-based sync has to
  reimplement the HMAC in SQL and keep a copy of the secret in the database,
  where a rotated env var silently produces tokens that match nothing. Here the
  token is computed by the same function the DM worker used.

No new dependencies. Talks to Supabase over `fetch`.

## Environment

    INCENSION_SUPABASE_URL          https://<ref>.supabase.co
    INCENSION_SUPABASE_SERVICE_KEY  service-role key (server only, never NEXT_PUBLIC_)
    INCENSION_SYNC_SECRET           shared secret the cron caller presents
    INCENSION_ERA                   defaults to h1
