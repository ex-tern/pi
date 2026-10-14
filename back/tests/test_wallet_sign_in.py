"""Signing in with a wallet needs a message this server issued, signed once.

A signature over any other text (one made on another site, an old one, or one
over a message the browser wrote itself) must not sign anybody in.
"""

import os
import tempfile

import pytest

os.environ.setdefault("SCHOLARPI_DATA_DIR", tempfile.mkdtemp())
os.environ.setdefault("SESSION_SECRET", "test-secret-for-wallet")

import api  # noqa: E402
from eth_account import Account  # noqa: E402
from eth_account.messages import encode_defunct  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    api._RATE_LIMIT_BUCKETS.clear()
    return TestClient(api.app)


@pytest.fixture
def wallet():
    return Account.create()


def sign(acct, text):
    return acct.sign_message(encode_defunct(text=text)).signature.hex()


def nonce_message(client, acct):
    r = client.get("/api/auth/wallet/nonce", params={"address": acct.address})
    assert r.status_code == 200
    return r.json()["message"]


def verify(client, acct, message, signature):
    return client.post("/api/auth/wallet/verify",
                       json={"address": acct.address, "message": message, "signature": signature}).json()


def test_an_issued_message_signs_in(client, wallet):
    msg = nonce_message(client, wallet)
    assert wallet.address in msg and "Nonce: " in msg
    out = verify(client, wallet, msg, sign(wallet, msg))
    assert out["authenticated"] and out["token"]


def test_a_message_is_accepted_only_once(client, wallet):
    msg = nonce_message(client, wallet)
    sig = sign(wallet, msg)
    assert verify(client, wallet, msg, sig)["authenticated"]
    again = verify(client, wallet, msg, sig)
    assert not again["authenticated"] and not again["token"]


def test_a_message_written_elsewhere_is_refused(client, wallet):
    msg = ("example.com wants you to sign in with your Ethereum account:\n" + wallet.address +
           "\n\nNonce: 0123456789abcdef0123456789abcdef\nIssued At: 2026-01-01T00:00:00Z")
    out = verify(client, wallet, msg, sign(wallet, msg))
    assert not out["authenticated"] and not out["token"]


def test_a_message_issued_to_another_address_is_refused(client, wallet):
    other = Account.create()
    msg = nonce_message(client, other)
    out = verify(client, wallet, msg, sign(wallet, msg))
    assert not out["authenticated"]


def test_an_altered_message_is_refused(client, wallet):
    msg = nonce_message(client, wallet) + "\nResources: anything"
    out = verify(client, wallet, msg, sign(wallet, msg))
    assert not out["authenticated"]


def test_an_expired_message_is_refused(client, wallet, monkeypatch):
    monkeypatch.setattr(api, "SIGN_IN_NONCE_TTL", -1)
    msg = nonce_message(client, wallet)
    out = verify(client, wallet, msg, sign(wallet, msg))
    assert not out["authenticated"]


def test_someone_elses_signature_is_refused(client, wallet):
    msg = nonce_message(client, wallet)
    out = verify(client, wallet, msg, sign(Account.create(), msg))
    assert not out["authenticated"]
