#!/usr/bin/env python3
"""
Publish a generated post (<id>.json from generate.py) to X.

    python xpost.py selftest                       # check the request signing, offline
    python xpost.py whoami                         # check the keys work
    python xpost.py publish social/round-04/pre/hot-hand.json [--lang en|he] [--yes]

Credentials come from the environment or backend/.env (never committed):
    X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET          the main account
    X_HE_API_KEY, X_HE_API_SECRET, X_HE_ACCESS_TOKEN, X_HE_ACCESS_SECRET   optional Hebrew account

Get them from developer.x.com: create a Project + App (the Free tier covers ~500 posts a
month), set app permissions to "Read and write", then generate the Access Token and
Secret *after* changing the permissions.

Standard library only: OAuth 1.0a (HMAC-SHA1) is implemented here.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
API = "https://api.x.com/2"
MEDIA_V2 = "https://api.x.com/2/media/upload"
MEDIA_V1 = "https://upload.twitter.com/1.1/media/upload.json"


def load_env():
    """backend/.env, without overriding anything already set."""
    path = REPO / "backend" / ".env"
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def credentials(lang="en"):
    prefix = "X_HE_" if lang == "he" else "X_"
    keys = [f"{prefix}{k}" for k in ("API_KEY", "API_SECRET", "ACCESS_TOKEN", "ACCESS_SECRET")]
    values = [os.environ.get(k, "").strip() for k in keys]
    return dict(zip(("key", "secret", "token", "token_secret"), values)) if all(values) else None


def _q(value):
    return urllib.parse.quote(str(value), safe="~")


def oauth_header(method, url, creds, params=None, nonce=None, timestamp=None):
    """The Authorization header for a request. `params` are query/form parameters that
    take part in the signature (a JSON or multipart body does not)."""
    oauth = {
        "oauth_consumer_key": creds["key"],
        "oauth_nonce": nonce or secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(timestamp or int(time.time())),
        "oauth_token": creds["token"],
        "oauth_version": "1.0",
    }
    signed = {**(params or {}), **oauth}
    param_string = "&".join(f"{k}={v}" for k, v in sorted((_q(k), _q(v)) for k, v in signed.items()))
    base = "&".join([method.upper(), _q(url), _q(param_string)])
    key = f"{_q(creds['secret'])}&{_q(creds['token_secret'])}"
    oauth["oauth_signature"] = base64.b64encode(hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()).decode()
    return "OAuth " + ", ".join(f'{_q(k)}="{_q(v)}"' for k, v in sorted(oauth.items()))


def _send(req):
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            body = res.read()
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as err:
        detail = err.read().decode(errors="replace")[:500]
        raise RuntimeError(f"X API {err.code} on {req.full_url}: {detail}") from None


def upload_image(path, creds):
    """Upload a PNG and return its media id (v2 endpoint, falling back to v1.1)."""
    data = Path(path).read_bytes()
    boundary = secrets.token_hex(12)
    for url, fields in ((MEDIA_V2, {"media_category": "tweet_image"}), (MEDIA_V1, {})):
        parts = [f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode()
                 for k, v in fields.items()]
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"media\"; filename=\"card.png\"\r\n"
                     f"Content-Type: image/png\r\n\r\n".encode() + data + b"\r\n")
        body = b"".join(parts) + f"--{boundary}--\r\n".encode()
        req = urllib.request.Request(url, data=body, method="POST", headers={
            "Authorization": oauth_header("POST", url, creds),
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        })
        try:
            res = _send(req)
        except RuntimeError as err:
            if url == MEDIA_V2 and (" 404 " in str(err) or " 403 " in str(err)):
                continue
            raise
        media_id = (res.get("data") or {}).get("id") or res.get("media_id_string")
        if media_id:
            return str(media_id)
    raise RuntimeError("Image upload returned no media id.")


def create_tweet(creds, text, media_ids=None, reply_to=None, poll=None):
    payload = {"text": text}
    if media_ids:
        payload["media"] = {"media_ids": media_ids}
    if reply_to:
        payload["reply"] = {"in_reply_to_tweet_id": str(reply_to)}
    if poll:
        payload["poll"] = {"options": poll["options"], "duration_minutes": int(poll["minutes"])}
    url = f"{API}/tweets"
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST", headers={
        "Authorization": oauth_header("POST", url, creds), "Content-Type": "application/json"})
    return _send(req)["data"]["id"]


def whoami(creds):
    url = f"{API}/users/me"
    req = urllib.request.Request(url, headers={"Authorization": oauth_header("GET", url, creds)})
    return _send(req)["data"]


def publish(post, lang, creds):
    """Post one generated post in one language. Returns the tweet ids, first one first."""
    tweets = post["tweets"][lang]
    if tweets.get("thread"):
        ids, previous = [], None
        for i, text in enumerate(tweets["thread"]):
            media = [upload_image(post["image"], creds)] if i == 0 and post.get("image") else None
            previous = create_tweet(creds, text, media_ids=media, reply_to=previous)
            ids.append(previous)
        return ids
    media = [upload_image(post["image"], creds)] if post.get("image") and not tweets.get("poll") else None
    main = create_tweet(creds, tweets["main"], media_ids=media, poll=tweets.get("poll"))
    reply = create_tweet(creds, tweets["reply"], reply_to=main)
    return [main, reply]


def selftest():
    """X's own documented example (developer.x.com, 'Creating a signature')."""
    creds = {"key": "xvz1evFS4wEEPTGEFPHBog", "secret": "kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw",
             "token": "370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb",
             "token_secret": "LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE"}
    header = oauth_header("POST", "https://api.twitter.com/1.1/statuses/update.json", creds,
                          params={"status": "Hello Ladies + Gentlemen, a signed OAuth request!", "include_entities": "true"},
                          nonce="kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg", timestamp=1318622958)
    expected = _q("hCtSmYh+iHYCEqBWrE7C7hYmtUk=")
    ok = f'oauth_signature="{expected}"' in header
    print("signature self-test:", "PASS" if ok else f"FAIL\n{header}")
    return ok


def main():
    load_env()
    args = sys.argv[1:]
    if not args or args[0] not in ("selftest", "whoami", "publish"):
        sys.exit(__doc__)
    if args[0] == "selftest":
        sys.exit(0 if selftest() else 1)
    lang = args[args.index("--lang") + 1] if "--lang" in args else "en"
    creds = credentials(lang)
    if not creds:
        sys.exit(f"No X credentials for '{lang}' - set them in backend/.env (see the top of this file).")
    if args[0] == "whoami":
        print(whoami(creds))
        return
    post = json.loads(Path(args[1]).read_text())
    tweets = post["tweets"][lang]
    print("\n---\n".join(tweets.get("thread") or [tweets["main"], "↳ " + tweets["reply"]]))
    if "--yes" not in args and input("\nPost this? [y/N] ").strip().lower() != "y":
        sys.exit("Not posted.")
    print("Posted:", publish(post, lang, creds))


if __name__ == "__main__":
    main()
