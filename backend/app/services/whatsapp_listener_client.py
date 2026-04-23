"""
HTTP client for the WhatsApp Listener (Node service).

The listener holds the only WhatsApp session; this client is how the Python
backend talks to it over HTTP. Contract lives in the listener repo at
WhatsApp Listener/API_SPEC.yaml.

Pure requests + stdlib. No Flask dependency so the worker process can import
this too.
"""
from __future__ import annotations

import base64
import os
from typing import Any, Optional

import requests


class WhatsAppListenerError(Exception):
    """Base class for all listener client errors."""

    def __init__(self, message: str, status_code: Optional[int] = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class WhatsAppAuthError(WhatsAppListenerError):
    """401 — API key missing or wrong."""


class WhatsAppBadRequestError(WhatsAppListenerError):
    """400 — malformed request (missing chatId, empty text, etc)."""


class WhatsAppNumberNotRegisteredError(WhatsAppListenerError):
    """404 from /api/send — recipient phone number is not on WhatsApp."""


class WhatsAppNotConnectedError(WhatsAppListenerError):
    """503 from /api/send — listener has no live WhatsApp socket."""


class WhatsAppPayloadTooLargeError(WhatsAppListenerError):
    """413 from /api/send-document — file exceeds the listener's 25 MB JSON body cap."""


class WhatsAppServerError(WhatsAppListenerError):
    """Any other 5xx or unexpected response."""


class WhatsAppListenerClient:
    def __init__(self, base_url: str, api_key: str, timeout: int = 30):
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.timeout = timeout
        self._session = requests.Session()
        self._session.headers.update({'Authorization': f'Bearer {api_key}'})

    @classmethod
    def from_env(cls) -> Optional['WhatsAppListenerClient']:
        """Build a client from WA_LISTENER_URL / WA_LISTENER_API_KEY. Returns None if URL is unset."""
        base_url = os.environ.get('WA_LISTENER_URL')
        if not base_url:
            return None
        api_key = os.environ.get('WA_LISTENER_API_KEY', 'local-test-key-change-me')
        return cls(base_url=base_url, api_key=api_key)

    # ----- discovery -----

    def status(self) -> dict:
        return self._get('/api/status')

    def qr(self) -> dict:
        return self._get('/api/qr')

    def list_chats(self) -> dict[str, str]:
        return self._get('/api/chats')

    def list_groups(self) -> dict[str, str]:
        return {cid: name for cid, name in self.list_chats().items() if cid.endswith('@g.us')}

    # ----- listen -----

    def get_listen_list(self) -> list[str]:
        return self._get('/api/listen').get('chatIds', [])

    def register(self, chat_id: str) -> list[str]:
        return self._post('/api/listen', {'chatId': chat_id}).get('chatIds', [])

    def unregister(self, chat_id: str) -> list[str]:
        return self._delete(f'/api/listen/{chat_id}').get('chatIds', [])

    # ----- messages -----

    def fetch_messages(
        self,
        chat_id: Optional[str] = None,
        since: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> list[dict]:
        params: dict[str, Any] = {}
        if chat_id is not None:
            params['chatId'] = chat_id
        if since is not None:
            params['since'] = since
        if limit is not None:
            params['limit'] = limit
        return self._get('/api/messages', params=params)

    # ----- send -----

    def send(self, chat_id: str, text: str) -> None:
        self._post('/api/send', {'chatId': chat_id, 'text': text})

    def send_document(
        self,
        chat_id: str,
        file_bytes: bytes,
        filename: str,
        caption: Optional[str] = None,
        mimetype: Optional[str] = None,
    ) -> None:
        payload: dict[str, Any] = {
            'chatId': chat_id,
            'fileBase64': base64.b64encode(file_bytes).decode('ascii'),
            'filename': filename,
        }
        if caption is not None:
            payload['caption'] = caption
        if mimetype is not None:
            payload['mimetype'] = mimetype
        self._post('/api/send-document', payload)

    # ----- internals -----

    def _get(self, path: str, params: Optional[dict] = None) -> Any:
        return self._request('GET', path, params=params)

    def _post(self, path: str, body: dict) -> Any:
        return self._request('POST', path, json=body)

    def _delete(self, path: str) -> Any:
        return self._request('DELETE', path)

    def _request(self, method: str, path: str, **kwargs) -> Any:
        url = f'{self.base_url}{path}'
        try:
            resp = self._session.request(method, url, timeout=self.timeout, **kwargs)
        except requests.RequestException as e:
            raise WhatsAppListenerError(f'Network error calling {method} {path}: {e}') from e

        if resp.ok:
            if resp.status_code == 204 or not resp.content:
                return None
            return resp.json()

        body: Any = None
        try:
            body = resp.json()
        except ValueError:
            body = resp.text

        message = f'{method} {path} failed with {resp.status_code}: {body}'
        if resp.status_code == 401:
            raise WhatsAppAuthError(message, resp.status_code, body)
        if resp.status_code == 400:
            raise WhatsAppBadRequestError(message, resp.status_code, body)
        if resp.status_code == 404:
            raise WhatsAppNumberNotRegisteredError(message, resp.status_code, body)
        if resp.status_code == 413:
            raise WhatsAppPayloadTooLargeError(message, resp.status_code, body)
        if resp.status_code == 503:
            raise WhatsAppNotConnectedError(message, resp.status_code, body)
        raise WhatsAppServerError(message, resp.status_code, body)
