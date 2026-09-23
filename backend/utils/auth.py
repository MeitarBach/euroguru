"""
Who is making this request, according to Supabase.

Identification, not enforcement. Most of EuroGuru is free and answers anonymous
requests exactly as it always has; what this adds is that a request carrying a valid
token is now *recognised*. Turning recognition into a restriction is one dependency
swap at whichever route earns it - see `require_user` at the bottom - and no route
does that today.

Verification is against the project's public JWKS, so nothing secret lives here. New
Supabase projects sign with ES256 on a P-256 key; RS256 is accepted too because a
project migrated from the older symmetric default lands there.
"""

import logging
import os

import jwt
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, Request
from jwt import PyJWKClient

# Same as s3_utils and data_fetchers do. This module reads its config at import time,
# so relying on some other module having loaded the file first would make the result
# depend on import order - it works until someone reorders the imports in main.py.
load_dotenv()

log = logging.getLogger(__name__)

SUPABASE_URL = (os.environ.get("SUPABASE_URL") or "").rstrip("/")

# Supabase stamps every access token with this audience. Configurable only because a
# project can be made to issue something else; nothing here needs it to be.
AUDIENCE = os.environ.get("SUPABASE_JWT_AUDIENCE", "authenticated")

ALGORITHMS = ["ES256", "RS256"]

_jwks_client = None


def _jwks():
    """
    The JWKS client, built once per process.

    Built lazily rather than at import: this module is imported by a serverless
    container that may only ever serve anonymous requests, and those should not pay
    for a key fetch they will never use. PyJWKClient caches the key set in-process,
    so the fetch happens at most once per cold start, and the timeout keeps a slow
    or hanging JWKS endpoint from holding a request open for the default 30s.
    """
    global _jwks_client
    if _jwks_client is None and SUPABASE_URL:
        _jwks_client = PyJWKClient(
            f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json",
            cache_keys=True,
            timeout=5,
        )
    return _jwks_client


def _verify(token):
    """Claims for a valid token. Raises for anything else."""
    client = _jwks()
    if client is None:
        raise RuntimeError("SUPABASE_URL is not set, so tokens cannot be verified.")

    signing_key = client.get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=ALGORITHMS,
        audience=AUDIENCE,
        issuer=f"{SUPABASE_URL}/auth/v1",
    )


async def optional_user(request: Request):
    """
    The signed-in user's claims, or None.

    Never raises - not for a malformed header, an expired or forged token, a missing
    SUPABASE_URL, or an unreachable JWKS endpoint. That is the whole point: anonymous
    access is currently *all* access, so an auth outage that turned into a 500 would
    take down a site that does not even require auth. A request that cannot be
    identified is simply anonymous, which is a state this API already handles on every
    route.
    """
    header = request.headers.get("authorization") or ""
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None

    try:
        return _verify(token.strip())
    except jwt.ExpiredSignatureError:
        # Routine: the client refreshes and retries. Not worth a warning.
        log.info("Rejected an expired access token.")
        return None
    except jwt.InvalidTokenError as exc:
        log.info("Rejected an invalid access token: %s", exc)
        return None
    except Exception as exc:  # noqa: BLE001 - see the docstring
        log.warning("Could not verify an access token: %s", exc)
        return None


async def require_user(user=Depends(optional_user)):
    """
    The signed-in user's claims, or 401.

    Applied to no route yet. When a feature becomes paid, its route swaps
    `Depends(optional_user)` for `Depends(require_user)` and gains nothing else.
    """
    if user is None:
        raise HTTPException(
            status_code=401,
            detail="Sign in to use this endpoint.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user
