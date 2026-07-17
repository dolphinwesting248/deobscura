#!/usr/bin/env python3
"""
Weibo wbBotDetector — AES-CBC + RSA-OAEP encryption replica.

Reverse-engineered from deobscura output of weibo_fp.js.
Source: E:/deobscura/test/output/live/weibo_fp/main.js

Algorithm chain (We function, lines 924-949):
  1. Generate random 128-bit AES key + 16-byte IV
  2. RSA-OAEP(SHA-256) encrypt (AES_key || IV) with embedded 1024-bit pubkey
  3. AES-CBC encrypt the fingerprint JSON
  4. Assemble: "01" + base64("01" + rsa_ct + "02" + aes_ct)

Requires: pip install cryptography
"""

import base64
import json
import os

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography.hazmat.primitives import hashes, serialization

# Embedded RSA public key — DER-encoded SPKI from main.js line 925
# 1024-bit RSA, exponent 65537
_SPKI_DER = bytes([
    48, 129, 159, 48, 13, 6, 9, 42, 134, 72, 134, 247, 13, 1, 1, 1,
    5, 0, 3, 129, 141, 0, 48, 129, 137, 2, 129, 129, 0, 180, 249,
    101, 74, 227, 247, 222, 230, 24, 220, 10, 149, 183, 131, 164, 185,
    20, 166, 164, 114, 158, 71, 46, 151, 77, 71, 226, 23, 78, 67, 177,
    246, 197, 249, 213, 39, 243, 55, 38, 112, 17, 64, 135, 155, 109, 50,
    185, 61, 21, 105, 106, 245, 148, 212, 127, 7, 18, 227, 255, 40, 199,
    241, 65, 211, 167, 185, 232, 5, 186, 189, 245, 59, 161, 214, 48,
    160, 251, 21, 92, 187, 172, 83, 152, 11, 85, 72, 37, 137, 87, 104,
    63, 39, 86, 6, 150, 84, 6, 178, 229, 220, 144, 133, 131, 212, 47,
    139, 232, 185, 192, 97, 89, 137, 170, 141, 39, 19, 85, 4, 153, 238,
    75, 93, 243, 96, 206, 72, 135, 91, 2, 3, 1, 0, 1
])


def _load_pubkey():
    key = serialization.load_der_public_key(_SPKI_DER)
    assert isinstance(key, rsa.RSAPublicKey) and key.key_size == 1024
    return key


def _pkcs7_pad(data: bytes, block_size: int = 16) -> bytes:
    pad_len = block_size - (len(data) % block_size)
    return data + bytes([pad_len] * pad_len)


def weibo_encrypt(fp_data: dict, bh_data: dict | None = None,
                  meta: dict | None = None) -> str:
    """
    Replica of We() + Ie() — encrypt fingerprint data for Weibo SSO.

    Args:
        fp_data:  Fingerprint collector outputs (keys "0".."23")
        bh_data:  Behaviour data {mt: [[x,y,t],...], kt: {key: count}}
        meta:     {isTraceKeyboard: bool, isTraceMouse: bool}

    Returns:
        Payload string starting with "01", ready for POST to
        https://passport.weibo.com/sso/bd
    """
    pubkey = _load_pubkey()

    # 1. Generate ephemeral AES-128 key + random 16-byte IV
    aes_key = os.urandom(16)
    iv = os.urandom(16)

    # 2. RSA-OAEP(SHA-256) encrypt the 32-byte key material
    key_material = aes_key + iv
    rsa_ct = pubkey.encrypt(
        key_material,
        padding.OAEP(
            mgf=padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )

    # 3. AES-CBC encrypt the JSON payload
    payload_obj = {"fp": fp_data}
    if bh_data is not None:
        payload_obj["bh"] = bh_data
    if meta is not None:
        payload_obj["meta"] = meta

    plaintext = json.dumps(payload_obj, separators=(",", ":"), ensure_ascii=False)
    pt_bytes = plaintext.encode("utf-8")

    cipher = Cipher(algorithms.AES(aes_key), modes.CBC(iv))
    encryptor = cipher.encryptor()
    aes_ct = encryptor.update(_pkcs7_pad(pt_bytes)) + encryptor.finalize()

    # 4. Assemble: "01" + base64("01" + rsa_ct + "02" + aes_ct)
    inner = b"01" + rsa_ct + b"02" + aes_ct
    return "01" + base64.b64encode(inner).decode("ascii")


if __name__ == "__main__":
    sample = {
        "fp": {
            "0": "canvas_hash_example",
            "1": "webgl_renderer_example",
            "2": "plugin_list_example",
            "3": "timezone_offset_480",
            "4": "screen_1920x1080",
            "5": "language_zh-CN",
            "6": "platform_Win32",
            "7": "hardwareConcurrency_8",
            "8": "deviceMemory_8",
        },
        "bh": {
            "mt": [[100, 200, 1700000000000], [150, 250, 1700000000100]],
            "kt": {"KeyA": 5, "KeyB": 3},
        },
        "meta": {"isTraceKeyboard": False, "isTraceMouse": True},
    }

    result = weibo_encrypt(fp_data=sample["fp"], bh_data=sample.get("bh"), meta=sample.get("meta"))
    print(f"Payload ({len(result)} chars):")
    print(result[:120] + "..." if len(result) > 120 else result)

    # Verify structure
    inner_b64 = result[2:]
    inner = base64.b64decode(inner_b64)
    assert inner[:2] == b"01", f"bad inner prefix: {inner[:2]}"
    sep = inner.index(b"02", 2)
    rsa_part = inner[2:sep]
    aes_part = inner[sep + 2:]

    print(f"\nRSA ct: {len(rsa_part)} bytes (expect 128)")
    print(f"AES ct: {len(aes_part)} bytes")
    print("All checks passed.")
