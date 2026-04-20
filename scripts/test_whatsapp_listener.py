"""
Interactive local test for the WhatsApp Listener integration (Phase 1).

Walks through the five exit-criteria checkboxes from
WhatsApp Listener/LOCAL_INTEGRATION.md end-to-end:
  1. List groups and their IDs.
  2. Register + unregister a group.
  3. New messages (text + image with caption) show up via polling.
  4. Send a message to a phone number.
  5. Requests without the bearer token are rejected with 401.

Usage:
    # Make sure the Node listener is running and the dashboard QR is scanned.
    export WA_LISTENER_URL=http://localhost:3333
    export WA_LISTENER_API_KEY=local-test-key-change-me
    python scripts/test_whatsapp_listener.py

This script is manual on purpose — it needs a live WhatsApp session and a
human holding a phone. It is NOT a pytest test.
"""
from __future__ import annotations

import base64
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Make `app.services...` importable from a repo-root invocation.
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / 'backend'))

from app.services.whatsapp_listener_client import (  # noqa: E402
    WhatsAppAuthError,
    WhatsAppListenerClient,
    WhatsAppListenerError,
    WhatsAppNotConnectedError,
    WhatsAppNumberNotRegisteredError,
)


RESULTS: dict[str, bool] = {
    '1. List groups and IDs': False,
    '2. Register + unregister a group': False,
    '3. Receive text + image-with-caption via polling': False,
    '4. Send a text to a phone number': False,
    '5. Missing/bad API key → 401': False,
}


def section(title: str) -> None:
    print(f'\n========== {title} ==========')


def prompt(msg: str) -> str:
    try:
        return input(f'{msg} ').strip()
    except EOFError:
        return ''


def pause(msg: str) -> None:
    try:
        input(f'{msg} [Enter to continue] ')
    except EOFError:
        pass


def abort(msg: str) -> None:
    print(f'\n[ABORT] {msg}')
    summarize()
    sys.exit(1)


def summarize() -> None:
    print('\n========== Results ==========')
    width = max(len(k) for k in RESULTS)
    for name, ok in RESULTS.items():
        tag = '[PASS]' if ok else '[FAIL]'
        print(f'  {tag}  {name.ljust(width)}')
    failed = [k for k, v in RESULTS.items() if not v]
    print()
    if failed:
        print(f'{len(failed)}/{len(RESULTS)} checkbox(es) still failing.')
        sys.exit(2)
    else:
        print('All 5 Phase 1 checkboxes passed.')


def main() -> None:
    base_url = os.environ.get('WA_LISTENER_URL', 'http://localhost:3333')
    api_key = os.environ.get('WA_LISTENER_API_KEY', 'local-test-key-change-me')
    print(f'Listener: {base_url}')
    print(f'API key:  {api_key[:6]}... (len={len(api_key)})')

    client = WhatsAppListenerClient(base_url, api_key)

    # --- Auth negative test (checkbox 5) ---
    section('Checkbox 5 — Auth negative test')
    bad = WhatsAppListenerClient(base_url, 'definitely-not-the-key')
    try:
        bad.status()
        print('  Expected 401 with a bad key, got 200. Is API_KEY enforcement on?')
    except WhatsAppAuthError:
        print('  OK — bad key rejected with 401.')
        RESULTS['5. Missing/bad API key → 401'] = True
    except WhatsAppListenerError as e:
        print(f'  Unexpected error with bad key: {e}')

    # --- Status sanity ---
    section('Status sanity check')
    try:
        st = client.status()
    except WhatsAppListenerError as e:
        abort(f'Could not reach the listener at {base_url}: {e}')
    print(f'  status: {st}')
    if not st.get('connected'):
        abort('Listener reports connected=false. Open the dashboard and scan the QR, then rerun.')

    # --- List groups (checkbox 1) ---
    section('Checkbox 1 — List groups')
    try:
        groups = client.list_groups()
    except WhatsAppListenerError as e:
        abort(f'list_groups failed: {e}')
    if not groups:
        abort('No groups returned. Join at least one WhatsApp group with this phone, then rerun.')
    for cid, name in groups.items():
        print(f'  {cid}  →  {name}')
    RESULTS['1. List groups and IDs'] = True

    chat_id = prompt('Paste the chatId of a group you can send messages to:')
    if not chat_id or not chat_id.endswith('@g.us'):
        abort('Expected a group chatId ending in @g.us.')

    # --- Register / unregister roundtrip (checkbox 2) ---
    section('Checkbox 2 — Register + unregister')
    try:
        after_add = client.register(chat_id)
        print(f'  After register:   {after_add}')
        assert chat_id in after_add, 'chatId not in listen list after register'

        after_remove = client.unregister(chat_id)
        print(f'  After unregister: {after_remove}')
        assert chat_id not in after_remove, 'chatId still in listen list after unregister'

        after_re_add = client.register(chat_id)
        print(f'  Re-registered for the receive test: {after_re_add}')
        assert chat_id in after_re_add
        RESULTS['2. Register + unregister a group'] = True
    except (AssertionError, WhatsAppListenerError) as e:
        print(f'  FAIL: {e}')

    # --- Receive (checkbox 3) ---
    section('Checkbox 3 — Receive text + image with caption (forward-only)')
    since = datetime.now(timezone.utc).isoformat()
    print(f'  Poll cursor (since): {since}')
    print('  From your phone, send the following to the registered group NOW:')
    print('    (a) one plain text message')
    print('    (b) one IMAGE with a caption')
    pause('  Press Enter once both are sent.')

    got_text = False
    got_image_with_caption = False
    seen_ids: set[str] = set()
    deadline = time.time() + 60
    while time.time() < deadline and not (got_text and got_image_with_caption):
        try:
            msgs = client.fetch_messages(chat_id=chat_id, since=since)
        except WhatsAppListenerError as e:
            print(f'  poll error: {e}')
            time.sleep(5)
            continue
        for m in msgs:
            mid = m.get('messageId', '')
            if mid in seen_ids:
                continue
            seen_ids.add(mid)
            _dump_message(m)
            media_type = m.get('mediaType')
            text = m.get('text')
            if media_type is None and text:
                got_text = True
            if media_type == 'image' and isinstance(m.get('mediaData'), str) and m['mediaData'].startswith('data:image/'):
                _save_image(m)
                if text:
                    got_image_with_caption = True
        if not (got_text and got_image_with_caption):
            time.sleep(5)
    print(f'  captured {len(seen_ids)} message(s) — text_ok={got_text} image_with_caption_ok={got_image_with_caption}')
    if got_text and got_image_with_caption:
        RESULTS['3. Receive text + image-with-caption via polling'] = True
    else:
        print('  FAIL: did not capture both a text message and an image-with-caption.')
        print('         Common causes: image sent without caption; message sent before the "since" cursor;')
        print('         mediaType/mediaData shape differs from spec (see dump above).')

    # --- Send positive + negative (checkbox 4) ---
    section('Checkbox 4 — Send a text to a phone number')
    for attempt in range(3):
        phone = prompt('Phone number (digits only, no +, e.g. 972501234567) you can watch — or "skip":')
        if phone.lower() == 'skip':
            print('  Skipped by user.')
            break
        if not re.fullmatch(r'\d{6,15}', phone or ''):
            print(f'  "{phone}" does not look like digits-only E.164. Try again or type "skip".')
            continue
        target = f'{phone}@s.whatsapp.net'
        try:
            client.send(target, 'Hello from AutomateHQ Phase 1 local test.')
            confirm = prompt(f'Did the message arrive on {phone}? (y/n):').lower()
            if confirm.startswith('y'):
                RESULTS['4. Send a text to a phone number'] = True
            else:
                print('  FAIL: user did not confirm receipt.')
            break
        except WhatsAppNotConnectedError as e:
            print(f'  FAIL: listener not connected — {e}')
            break
        except WhatsAppNumberNotRegisteredError as e:
            print(f'  {phone} is not on WhatsApp — try another number.')
            continue
        except WhatsAppListenerError as e:
            print(f'  FAIL: {e}')
            break

    print('\n  Negative send test: pinging an almost-certainly-unregistered number...')
    try:
        client.send('10000000000@s.whatsapp.net', 'should not arrive')
        print('  Unexpected 200 — either the number IS on WhatsApp, or the listener did not verify.')
    except WhatsAppNumberNotRegisteredError:
        print('  OK — 404 as expected for unregistered number.')
    except WhatsAppListenerError as e:
        print(f'  Unexpected error (not fatal): {e}')

    # --- Cleanup ---
    section('Cleanup')
    try:
        remaining = client.unregister(chat_id)
        print(f'  Unregistered test group. Remaining listen list: {remaining}')
    except WhatsAppListenerError as e:
        print(f'  cleanup warning: {e}')

    summarize()


def _dump_message(msg: dict) -> None:
    """Print the shape of a captured message without dumping huge base64 payloads."""
    media_data = msg.get('mediaData')
    if isinstance(media_data, str):
        preview = media_data[:40] + f'... (len={len(media_data)})'
    else:
        preview = repr(media_data)
    keys = sorted(msg.keys())
    text = msg.get('text')
    text_preview = (text[:60] + '…') if isinstance(text, str) and len(text) > 60 else text
    print(
        f'  [msg] id={msg.get("messageId")!r} ts={msg.get("timestamp")!r} '
        f'mediaType={msg.get("mediaType")!r} text={text_preview!r} '
        f'mediaData={preview} keys={keys}'
    )


def _save_image(msg: dict) -> None:
    """Decode the base64 data URL and write it to /tmp so the user can eyeball it."""
    data_url = msg['mediaData']
    match = re.match(r'data:(image/[a-zA-Z+.-]+);base64,(.+)', data_url)
    if not match:
        print('  (mediaData did not match the expected data:image/*;base64,... shape)')
        return
    mime, b64 = match.groups()
    ext = mime.split('/')[-1].split('+')[0]
    out = Path('/tmp') / f"wa_test_{msg.get('messageId', 'noid')}.{ext}"
    try:
        out.write_bytes(base64.b64decode(b64))
        print(f'  saved image → {out} ({out.stat().st_size} bytes, caption={msg.get("text")!r})')
    except Exception as e:
        print(f'  could not save image: {e}')


if __name__ == '__main__':
    main()
