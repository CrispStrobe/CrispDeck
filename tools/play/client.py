"""Small Google Play client; credentials and bearer assertions never reach output."""
import base64
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request

TOKEN_URL = 'https://oauth2.googleapis.com/token'
BASE = 'https://androidpublisher.googleapis.com'


class ApiError(RuntimeError):
    def __init__(self, status, method, path):
        self.status = status
        super().__init__(f'Google Play {method} {path.split("?")[0]} failed (HTTP {status}); inspect app access/listing readiness in Play Console')


def credentials():
    raw = os.getenv('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')
    if not raw:
        path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
        if path: raw = Path(path).read_text()
    if not raw:
        raise ValueError('Google Play publisher credentials are not configured')
    data = json.loads(raw)
    if data.get('type') != 'service_account' or not data.get('client_email', '').endswith('.gserviceaccount.com') or not data.get('private_key', '').startswith('-----BEGIN PRIVATE KEY-----'):
        raise ValueError('Supply a Google service-account credential for the CrispDeck app')
    if data.get('token_uri', TOKEN_URL) != TOKEN_URL:
        raise ValueError('Unexpected credential token endpoint')
    return data


def access_token():
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    data = credentials(); now = int(time.time())
    def encode(value): return base64.urlsafe_b64encode(value).rstrip(b'=').decode()
    header = {'alg': 'RS256', 'typ': 'JWT'}
    payload = {'iss': data['client_email'], 'scope': 'https://www.googleapis.com/auth/androidpublisher',
               'aud': TOKEN_URL, 'iat': now, 'exp': now + 3500}
    signing = '.'.join(encode(json.dumps(item, separators=(',', ':')).encode()) for item in (header, payload))
    key = serialization.load_pem_private_key(data['private_key'].encode(), password=None)
    assertion = signing + '.' + encode(key.sign(signing.encode(), padding.PKCS1v15(), hashes.SHA256()))
    request = urllib.request.Request(TOKEN_URL, data=urllib.parse.urlencode({
        'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': assertion}).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)['access_token']
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Google publisher authentication failed (HTTP {error.code}); check the configured service account') from None


class Client:
    def __init__(self): self.token = access_token()

    def call(self, method, path, body=None, media=None):
        payload = media.read_bytes() if media else json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(BASE + path, data=payload, method=method, headers={
            'Authorization': 'Bearer ' + self.token,
            'Content-Type': 'application/octet-stream' if media else 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=300 if media else 60) as response:
                raw = response.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as error:
            raise ApiError(error.code, method, path) from None
