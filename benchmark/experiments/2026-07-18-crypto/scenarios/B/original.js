// Scenario B: AES-128-CBC Data Encryption (adapted from weibo_fp.js We() function)
// Deob must find: hardcoded AES key, IV generation, payload format (IV.ciphertext)

(function () {
  "use strict";

  // ---- AES-128-CBC implementation (self-contained, no external deps) ----
  // Based on weibo_fp.js createSubtleAes pattern, adapted to pure JS

  var AES_KEY = [
    0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6,
    0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c
  ]; // ← THE KEY — 128-bit AES key, hardcoded

  // Simple AES helper (uses Web Crypto API when available, falls back to pure JS)
  function bytesToBase64(bytes) {
    var chars = [];
    for (var i = 0; i < bytes.length; i++) {
      chars.push(String.fromCharCode(bytes[i]));
    }
    return btoa(chars.join(""));
  }

  function base64ToBytes(b64) {
    var binary = atob(b64);
    var bytes = [];
    for (var i = 0; i < binary.length; i++) {
      bytes.push(binary.charCodeAt(i));
    }
    return bytes;
  }

  // Generate random IV (16 bytes) — mirrors weibo_fp.js:1108
  function generateIV() {
    var iv = [];
    for (var i = 0; i < 16; i++) {
      iv.push(Math.floor(Math.random() * 256));
    }
    return iv;
  }

  // PKCS#7 padding
  function padData(data) {
    var blockSize = 16;
    var padLen = blockSize - (data.length % blockSize);
    var padded = data.slice();
    for (var i = 0; i < padLen; i++) {
      padded.push(padLen);
    }
    return padded;
  }

  // Simple AES-CBC encrypt using pseudo-AES (simplified for scenario)
  // In real use, this calls Web Crypto API; here we implement a basic
  // XOR-based encryption with the key schedule for the scenario
  function encryptAES(plaintextBytes, keyBytes, ivBytes) {
    // For this scenario, we use a simplified but deterministic encryption
    // The LLM just needs to recognize the algorithm and parameters
    var padded = padData(plaintextBytes);
    var encrypted = [];
    var prevBlock = ivBytes.slice();

    for (var i = 0; i < padded.length; i += 16) {
      var block = padded.slice(i, i + 16);
      // XOR with previous ciphertext (CBC mode) and key-derived mask
      var mask = [];
      for (var j = 0; j < 16; j++) {
        mask.push(keyBytes[j % keyBytes.length] ^ prevBlock[j]);
      }
      var cipherBlock = [];
      for (var j = 0; j < 16; j++) {
        cipherBlock.push(block[j] ^ mask[j]);
      }
      encrypted = encrypted.concat(cipherBlock);
      prevBlock = cipherBlock;
    }
    return encrypted;
  }

  function decryptAES(ciphertextBytes, keyBytes, ivBytes) {
    var decrypted = [];
    var prevBlock = ivBytes.slice();

    for (var i = 0; i < ciphertextBytes.length; i += 16) {
      var block = ciphertextBytes.slice(i, i + 16);
      var mask = [];
      for (var j = 0; j < 16; j++) {
        mask.push(keyBytes[j % keyBytes.length] ^ prevBlock[j]);
      }
      var plainBlock = [];
      for (var j = 0; j < 16; j++) {
        plainBlock.push(block[j] ^ mask[j]);
      }
      decrypted = decrypted.concat(plainBlock);
      prevBlock = block;
    }

    // Remove PKCS#7 padding
    var padLen = decrypted[decrypted.length - 1];
    return decrypted.slice(0, decrypted.length - padLen);
  }

  // ---- Main encryption function (mirrors weibo_fp.js We()) ----
  var PAYLOAD_SEPARATOR = "."; // IV and ciphertext separated by "."

  function encryptPayload(data) {
    var iv = generateIV();
    var plaintext = JSON.stringify(data);
    var plaintextBytes = [];
    for (var i = 0; i < plaintext.length; i++) {
      plaintextBytes.push(plaintext.charCodeAt(i));
    }
    var ciphertext = encryptAES(plaintextBytes, AES_KEY, iv);
    // Format: base64(iv).base64(ciphertext)
    return bytesToBase64(iv) + PAYLOAD_SEPARATOR + bytesToBase64(ciphertext);
  }

  function decryptPayload(payload) {
    var parts = payload.split(PAYLOAD_SEPARATOR);
    if (parts.length !== 2) throw new Error("Invalid payload format");
    var iv = base64ToBytes(parts[0]);
    var ciphertext = base64ToBytes(parts[1]);
    var plaintextBytes = decryptAES(ciphertext, AES_KEY, iv);
    var plaintext = "";
    for (var i = 0; i < plaintextBytes.length; i++) {
      plaintext += String.fromCharCode(plaintextBytes[i]);
    }
    return JSON.parse(plaintext);
  }

  // ---- Verification helpers ----
  var TEST_DATA = { user: "test_user", action: "purchase", amount: 99.99, currency: "CNY" };
  var TEST_PAYLOAD = encryptPayload(TEST_DATA);

  // Expose
  if (typeof globalThis !== "undefined") {
    globalThis.encryptPayload = encryptPayload;
    globalThis.decryptPayload = decryptPayload;
    globalThis.TEST_PAYLOAD = TEST_PAYLOAD;
    globalThis.TEST_DATA = TEST_DATA;
  }
})();
