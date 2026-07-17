// Scenario C: RC4 String Table + HMAC-SHA256 Integrity Check
// (adapted from tmall_security.js a0_0x3411 + _S_l1_04_if_2)
// Deob must: decode RC4-encrypted string array, find HMAC key, verify integrity

(function () {
  "use strict";

  // ---- RC4 implementation ----
  var RC4_KEY = [0x4a, 0x3f, 0x8c, 0x12, 0x7b, 0x9e, 0x55, 0xd3]; // 64-bit RC4 key

  function rc4Decrypt(encryptedBytes) {
    var S = [];
    var i, j, temp;
    for (i = 0; i < 256; i++) S[i] = i;

    // KSA
    j = 0;
    for (i = 0; i < 256; i++) {
      j = (j + S[i] + RC4_KEY[i % RC4_KEY.length]) % 256;
      temp = S[i]; S[i] = S[j]; S[j] = temp;
    }

    // PRGA
    var result = [];
    i = 0; j = 0;
    for (var k = 0; k < encryptedBytes.length; k++) {
      i = (i + 1) % 256;
      j = (j + S[i]) % 256;
      temp = S[i]; S[i] = S[j]; S[j] = temp;
      var keystreamByte = S[(S[i] + S[j]) % 256];
      result.push(encryptedBytes[k] ^ keystreamByte);
    }
    return result;
  }

  function rc4Encrypt(plainBytes) {
    return rc4Decrypt(plainBytes); // RC4 is symmetric
  }

  function bytesToString(bytes) {
    return bytes.map(function (b) { return String.fromCharCode(b); }).join("");
  }

  function stringToBytes(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i));
    return bytes;
  }

  // ---- RC4-Encrypted String Table (adapted from tmall_security a0_0x3411) ----
  var _S = [
    [0xf, 0xb, 0x2e, 0xd1, 0x42, 0x69],                                        // → "verify"
    [0x10, 0x0, 0x28, 0xdd, 0x43, 0x62, 0x1a, 0xfe, 0xf9],                    // → "integrity"
    [0x1a, 0x6, 0x39, 0xdb, 0x4f, 0x4f, 0x15, 0xeb, 0xe9, 0xd, 0x8a, 0xa9],  // → "check_failed"
    [0xf, 0xf, 0x30, 0xd1, 0x40],                                              // → "valid"
    [0x11, 0x3, 0x3d, 0xdb, 0x7b, 0x7b, 0x16, 0xf3],                          // → "hmac_key"
    [0xa, 0x6, 0x3d, 0x8a, 0x11, 0x26],                                        // → "sha256"
    [0x1c, 0x1c, 0x2e, 0xd7, 0x56],                                            // → "error"
    [0xa, 0x1b, 0x3f, 0xdb, 0x41, 0x63, 0x0],                                  // → "success"
    [0xd, 0x7, 0x31, 0xdd, 0x57, 0x64, 0x12, 0xe7, 0xf0],                     // → "timestamp"
    [0xa, 0x7, 0x3b, 0xd6, 0x45, 0x64, 0x6, 0xf8, 0xe5],                      // → "signature"
    [0x18, 0x1e, 0x35, 0xe7, 0x57, 0x75, 0x10, 0xf8, 0xe5, 0x15],             // → "api_secret"
    [0xb, 0xb, 0x2d, 0xcd, 0x41, 0x63, 0x7, 0xd5, 0xe9, 0x5],                 // → "request_id"
    [0x9, 0xf, 0x25, 0xd4, 0x4b, 0x71, 0x17],                                  // → "payload"
    [0x10, 0x0, 0x35, 0xcc, 0x7b, 0x64, 0x1a, 0xe7, 0xe5],                    // → "init_time"
    [0x9, 0x1b, 0x3e, 0xe7, 0x50, 0x7f, 0x18, 0xef, 0xee],                    // → "pub_token"
    [0x1d, 0xb, 0x2a, 0xd1, 0x47, 0x75, 0x2c, 0xe3, 0xee, 0x7, 0x80],         // → "device_info"
    [0x18, 0x1b, 0x28, 0xd0],                                                   // → "auth"
    [0x1a, 0x1, 0x32, 0xde, 0x4d, 0x77, 0x6, 0xf8, 0xe5, 0x5],                // → "configured"
    [0x1e, 0xb, 0x28, 0xe7, 0x57, 0x75, 0x0, 0xf9, 0xe9, 0xe, 0x81],          // → "get_session"
    [0xf, 0xf, 0x30, 0xd1, 0x40, 0x71, 0x7, 0xef],                             // → "validate"
  ];

  function decodeString(index) {
    if (index < 0 || index >= _S.length) throw new Error("Invalid string index");
    return bytesToString(rc4Decrypt(_S[index]));
  }

  function decodeAllStrings() {
    var result = {};
    for (var i = 0; i < _S.length; i++) {
      result[i] = decodeString(i);
    }
    return result;
  }

  // ---- HMAC-SHA256 Implementation (simplified) ----
  var HMAC_KEY = "integrity_key_2025"; // ← THE HMAC KEY — hidden in code

  function simpleHash(str) {
    // Simplified hash for self-contained scenario — real code uses crypto.subtle
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      hash = ((hash << 5) - hash + ch) | 0;
      hash = ((hash << 7) ^ (hash >>> 25) + ch * 2654435761) | 0;
    }
    // Convert to hex string (deterministic)
    var h = Math.abs(hash).toString(16);
    while (h.length < 8) h = "0" + h;
    return h + h + h + h; // make it look like a 32-char hex hash
  }

  function hmacSha256(data, key) {
    var blockSize = 64;
    var keyBytes = stringToBytes(key);
    if (keyBytes.length > blockSize) keyBytes = stringToBytes(simpleHash(key));

    var oKeyPad = [], iKeyPad = [];
    for (var i = 0; i < blockSize; i++) {
      oKeyPad.push((keyBytes[i] || 0) ^ 0x5c);
      iKeyPad.push((keyBytes[i] || 0) ^ 0x36);
    }

    var innerData = bytesToString(iKeyPad) + data;
    var innerHash = simpleHash(innerData);
    var outerData = bytesToString(oKeyPad) + innerHash;
    return simpleHash(outerData);
  }

  // ---- Integrity Verification Function ----
  function verifyIntegrity(data, previousHash) {
    var currentHash = hmacSha256(data, HMAC_KEY);
    if (currentHash !== previousHash) {
      var errMsg = decodeString(2); // → "check_failed"
      throw new Error(errMsg);
    }
    return true;
  }

  // Verification test data
  var TEST_DATA = JSON.stringify({ request_id: "abc123", payload: "sensitive_data", timestamp: 1700000000 });
  var TEST_HASH = hmacSha256(TEST_DATA, HMAC_KEY);

  // Expose
  if (typeof globalThis !== "undefined") {
    globalThis.decodeString = decodeString;
    globalThis.decodeAllStrings = decodeAllStrings;
    globalThis.verifyIntegrity = verifyIntegrity;
    globalThis.hmacSha256 = hmacSha256;
    globalThis.TEST_DATA = TEST_DATA;
    globalThis.TEST_HASH = TEST_HASH;
  }
})();
