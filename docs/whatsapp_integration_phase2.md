# WhatsApp Listener Integration — Phase 2 Handoff

Phase 2 is narrow on purpose: **listen to one WhatsApp group per site, pull
images that arrive, feed them into the existing work-card extraction
pipeline.** No outbound sending, no dashboards beyond what's needed to
configure the link.

Anyone picking this up should be able to read only this file, the listener's
`LOCAL_INTEGRATION.md` / `API_SPEC.yaml`, and start Phase 2 cold.

---

## Background in one paragraph

The WhatsApp Listener is a separate Node service (repo at
`~/Desktop/WhatsApp Listener`, not part of this monorepo) that holds a
single long-lived WhatsApp session via Baileys. AutomateHQ never speaks
WhatsApp directly — it talks to the listener over HTTP to discover groups,
register which groups to capture, and poll captured messages. Phase 1
proved the HTTP contract works end-to-end on a laptop. Phase 2 wires
inbound messages into the existing ingest pipeline — the same one
Telegram uses today.

---

## What Phase 1 delivered

| Path | Role |
| --- | --- |
| [backend/app/services/whatsapp_listener_client.py](../backend/app/services/whatsapp_listener_client.py) | Thin HTTP client. No Flask/DB deps — importable from both the backend and the worker. |
| [scripts/test_whatsapp_listener.py](../scripts/test_whatsapp_listener.py) | Interactive manual test. Walks the 5 exit-criteria checkboxes from the listener's `LOCAL_INTEGRATION.md`. |
| [.env.example](../.env.example) | Added `WA_LISTENER_URL`, `WA_LISTENER_API_KEY`. |

Client surface Phase 2 will use (stable):

```python
client.status()                                              # {connected, hasAuth}
client.list_groups()                                         # {chat_id: name} for @g.us
client.register(chat_id)    /  client.unregister(chat_id)
client.fetch_messages(chat_id=..., since=..., limit=...)     # polling loop
```

Typed exceptions (all subclass `WhatsAppListenerError`):
`WhatsAppAuthError` (401), `WhatsAppBadRequestError` (400),
`WhatsAppNotConnectedError` (503), `WhatsAppServerError` (other).
(`WhatsAppNumberNotRegisteredError` exists too but is outbound-only.)

All 5 Phase 1 checkboxes passed on 2026-04-20 against `localhost:3333`
with a linked Israeli WhatsApp account.

---

## Wire observations that matter for Phase 2

Facts from the live run that aren't in the spec:

1. **Message shape, confirmed.** Keys present on every message:
   `chatId, chatName, isGroup, mediaType, mediaData, messageId, pushName,
   sender, text, timestamp`. Image messages have `mediaType="image"`;
   pure text has `mediaType=None`.

2. **Image payload.** `mediaData` is a `data:image/jpeg;base64,…`
   string. Test image: ~51 KB base64 → ~38 KB decoded JPEG. Work-card
   photos will be 1–5 MB decoded. The listener repo plans a
   `mediaUrl` replacement once it adds disk storage — keep the
   decode step isolated so swapping is one function.

3. **Caption arrives in `text`** on image messages. Hebrew survives
   UTF-8 cleanly. This is the field the extractor will read.

4. **Empty group names happen.** `/api/chats` returned
   `120363424305614403@g.us → ""` in the live run. The link-group UI
   must fall back to the chatId when name is empty or the row is
   invisible.

5. **Forward-only capture is real** and will bite in dev. Messages
   sent before `POST /api/listen` are never captured. The admin UI
   should say so explicitly next to the "link group" action.

6. **`hasAuth` is available on `/api/status`** alongside `connected` —
   useful for distinguishing "listener is up but not linked yet"
   (scan QR) from "listener is down" in the admin UI.

---

## Phase 2 scope — inbound image ingest only

Goal: a site owner sends a work-card photo into the configured WhatsApp
group (with an optional caption) and it lands in the existing extraction
pipeline, identical in behaviour to the Telegram path.

Mirror the Telegram implementation file-for-file. The existing Telegram
code is the template — prefer matching its shapes over reinventing.

| Telegram (reference) | WhatsApp (to build) |
| --- | --- |
| [worker/telegram_poller.py](../worker/telegram_poller.py) | `worker/whatsapp_poller.py` — daemon thread inside the worker process, polls every `WA_LISTENER_POLL_SECONDS` (default 10s). |
| [backend/app/models/telegram.py](../backend/app/models/telegram.py) | `backend/app/models/whatsapp.py` — `WhatsAppGroupConfig` (per site ↔ chat link, `current_processing_month`, `auto_advance_day`, `is_active`), `WhatsAppIngestedMessage` (dedup by `messageId`, plus `sender`, `push_name`, `caption`, `work_card_id`, `status`), `WhatsAppPollingState` (per-chatId `last_seen_timestamp` cursor). |
| [backend/app/repositories/telegram_repository.py](../backend/app/repositories/telegram_repository.py) | `backend/app/repositories/whatsapp_repository.py` |
| [backend/app/api/telegram_settings.py](../backend/app/api/telegram_settings.py) | `backend/app/api/whatsapp_settings.py` — endpoints: listener status, list available groups (proxy `client.list_groups()`), link group to site (calls `client.register()` + persists `WhatsAppGroupConfig`), unlink (`client.unregister()` + deactivate). |
| [frontend/src/pages/TelegramSettings.tsx](../frontend/src/pages/TelegramSettings.tsx) | `frontend/src/pages/WhatsAppSettings.tsx` — listener status banner, picker showing groups with an empty-name fallback, "link to site" dropdown. |

### Ingestion loop (single poller thread, all businesses)

```
every WA_LISTENER_POLL_SECONDS:
    for each active WhatsAppGroupConfig:
        cursor = polling_state[chat_id]   # ISO timestamp, or None
        msgs = client.fetch_messages(chat_id=chat_id, since=cursor, limit=50)
        for m in sorted(msgs, key=lambda x: x['timestamp']):
            if m['messageId'] in whatsapp_ingested_messages: continue
            if m.get('mediaType') != 'image':
                record_skipped(m); advance_cursor(m['timestamp']); continue
            image_bytes = base64.b64decode(m['mediaData'].split(',', 1)[1])
            work_card = create_work_card(
                site_id=config.site_id,
                image_bytes=image_bytes,
                caption=m.get('text'),
                source='whatsapp',
                ...
            )
            persist WhatsAppIngestedMessage(message_id=..., work_card_id=...)
            advance_cursor(m['timestamp'])
```

### Must-get-right list

- **Dedup on `messageId`, not timestamp.** `since=<last_ts>` is strictly
  after, but worker restarts / network retries can re-poll. `messageId`
  is the safe key. Match the `file_unique_id` pattern in
  `telegram_ingested_files`.
- **Advance the cursor per-message, not per-batch**, so a mid-batch
  crash doesn't replay the whole batch on restart.
- **Skip non-image messages, but record them** with `status='SKIPPED'`
  so we have an audit trail and can debug "why isn't my card showing
  up".
- **Caption into the extractor.** Reuse the existing
  `telegram_caption` column on work cards (see
  [backend/app/models/work_cards.py](../backend/app/models/work_cards.py)
  — introduced in migration
  [`i9d0e1f2g3h4_add_telegram_caption_fields.py`](../backend/migrations/versions/i9d0e1f2g3h4_add_telegram_caption_fields.py)).
  Rename to a generic `source_caption` if that feels cleaner — either
  way, avoid adding a symmetric `whatsapp_caption` that duplicates
  behaviour.
- **Route by site, not by name.** Each `WhatsAppGroupConfig` is 1:1
  with a site, so the incoming work card's `site_id` is already known.
  No fuzzy matching needed — simpler than some Telegram flows.
- **Fail softly when listener is down.** Catch
  `WhatsAppNotConnectedError` / network errors in the poll loop;
  log-and-continue, don't crash the worker process.
- **Surface forward-only in the link-group UI.** Right next to the
  "link this group" button, copy to the effect of: *"We'll start
  capturing from this moment — earlier messages in this group won't
  appear."*

### Task order

1. Add env vars + wire them in: `WA_LISTENER_URL`,
   `WA_LISTENER_API_KEY`, `WA_LISTENER_POLL_SECONDS` (default 10).
2. Migration + models: `whatsapp_group_configs`,
   `whatsapp_ingested_messages`, `whatsapp_polling_state`.
3. Repository layer mirroring
   [telegram_repository.py](../backend/app/repositories/telegram_repository.py).
4. Admin API blueprint `backend/app/api/whatsapp_settings.py`
   (status, list_groups, link, unlink).
5. Admin UI `WhatsAppSettings.tsx` — start as a near-copy of
   `TelegramSettings.tsx`, swap the client calls, add the empty-name
   and forward-only copy.
6. Worker daemon `worker/whatsapp_poller.py` — registered in
   [worker/run.py](../worker/run.py) the same way
   `telegram_poller` is.
7. End-to-end: link a site's group, send an image from a phone,
   confirm a work card is created with the caption carried through
   and the extraction pipeline runs.

### Explicitly out of scope (deferred)

- Outbound send (the "Send summary via WhatsApp" button).
- `contractor_phone` column on `sites`.
- Non-image messages becoming anything (text, videos, documents).
- Multiple groups per site, or one group linked to multiple sites.
- Prod deployment of the listener itself (tracked in the listener
  repo's `DEPLOYMENT_PLAN.md`).

---

## Open questions to resolve at the start of Phase 2

1. **Reuse `telegram_caption` or rename to `source_caption`?** Low-cost
   decision, but cheaper to make it now than later.
2. **Fallback when the listener is down for hours** — is silent
   log-and-continue enough, or do we want a heartbeat surfaced in the
   admin UI so nobody wonders why images stopped arriving?
3. **`mediaUrl` cutover** — when the listener adds disk-backed media,
   the decode step becomes an HTTP fetch. Keep that isolated.

---

## How to resume

```bash
# 1. Start the Node listener (separate repo) and scan QR.
cd ~/Desktop/WhatsApp\ Listener && node index.js

# 2. Sanity-check Phase 1 still works.
cd ~/Desktop/automatehq
source venv/bin/activate
export WA_LISTENER_URL=http://localhost:3333
export WA_LISTENER_API_KEY=local-test-key-change-me
python scripts/test_whatsapp_listener.py

# 3. Start Phase 2 at task 1 (env vars + migration) above.
```
