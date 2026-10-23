"""Decrypt investor passwords the app encrypted with this worker's public key.

The app stores only "v1.<key id>.<base64>" (RSA-OAEP, SHA-256, MGF1 SHA-256). The
private key (MT5_CREDENTIALS_PRIVATE_KEY, base64 PKCS#8 DER or PEM) exists only in
this worker's .env. Decrypted passwords are kept in memory only and never logged.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

VERSION = "v1"
_OAEP = padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None)


class CredentialError(Exception):
    """The ciphertext can't be decrypted with this worker's key (message never contains secrets)."""


def load_private_key(value: str) -> rsa.RSAPrivateKey:
    text = value.strip()
    try:
        if "-----BEGIN" in text:
            key = serialization.load_pem_private_key(text.replace("\\n", "\n").encode(), password=None)
        else:
            key = serialization.load_der_private_key(base64.b64decode(text), password=None)
    except Exception as exc:  # noqa: BLE001 - never echo key material
        raise CredentialError("MT5_CREDENTIALS_PRIVATE_KEY is not a valid private key") from exc
    if not isinstance(key, rsa.RSAPrivateKey):
        raise CredentialError("MT5_CREDENTIALS_PRIVATE_KEY must be an RSA key")
    return key


def key_id(key: rsa.RSAPrivateKey) -> str:
    """Same id the app computes: SHA-256 over the public key (SPKI DER), first 16 hex chars."""
    der = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(der).hexdigest()[:16]


def decrypt_password(token: str, key: rsa.RSAPrivateKey) -> str:
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != VERSION:
        raise CredentialError("unsupported password format")
    if parts[1] != key_id(key):
        raise CredentialError("the password was encrypted with a different key; re-enter it in the app")
    try:
        return key.decrypt(base64.b64decode(parts[2]), _OAEP).decode("utf-8")
    except Exception as exc:  # noqa: BLE001
        raise CredentialError("the stored password could not be decrypted; re-enter it in the app") from exc
