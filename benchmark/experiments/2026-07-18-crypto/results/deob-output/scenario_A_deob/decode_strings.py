"""
Decode the custom base64 strings and find the correct array rotation.
"""
import re
import hashlib

ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/="

RAW_STRINGS = [
    "ANrmALe", "AM9PBG", "EdDRow1FmJaYnq", "BgvUz3rO", "AMjJquG",
    "ww9juvu", "BfLiC24", "rxn3y0O", "BwnZBNe", "z3fhuNG",
    "tfDjs1m", "otyYnZy2Bvj1s2DR", "mta0mhjNzxH4tW", "mJCZmtK3nM9PEMPXsG",
    "mtG4mZa4ndvgCuzmt0q", "AfzTuwG", "q0rkB04", "ALf1CLu",
    "mtu1mdmXueHpCKHi", "DMvYAwz5", "nta2mwPlq2Tzua", "mJi2mun2yLDNBG",
    "rKrZAfq", "otK2ntC5rfrVCNjY", "C3bSAxq", "zM5lCLa",
    "mtaWvu5Jru9Q", "sePvque", "mNWXFdD8nNWWFdr8m3W1", "DhfsCe4",
    "vvzeqNm", "EvDktgC", "sfDJuwC", "CLj3CKG", "wLrwAKm",
    "mJq3odrove1eyNe", "tKHTz1a", "weP6qxi", "C3vIC3rY", "A2v5CW",
    "y2rdu1a", "ywn4C0C", "ExreEeq", "mI4X", "rNvnwfm",
    "C29YDa", "zuDwz1e", "Dg9mB3DLCKnHC2u", "Dg9tDhjPBMC",
    "wgXsvvi", "DezAAKK", "B1fUrxq", "mZvqwvzJCK8", "rM1dAem",
    "EejVrfe"
]

def decode_custom_b64(s):
    result_bytes = []
    accum = 0
    i = 0
    for ch in s:
        idx = ALPHABET.index(ch)
        if idx == 64:
            break
        if i % 4 == 0:
            accum = idx
        else:
            accum = accum * 64 + idx
        old_i = i
        i += 1
        if old_i % 4 != 0:
            shift = (-2 * i) & 6
            byte_val = (accum >> shift) & 0xFF
            result_bytes.append(byte_val)
    hex_str = ''.join(f'%{b:02x}' for b in result_bytes)
    from urllib.parse import unquote
    return unquote(hex_str)

def parse_js_int(s):
    s = s.strip()
    if s.lower().startswith('0x'):
        try:
            return int(s, 16)
        except:
            pass
    m = re.match(r'^-?\d+', s)
    if m:
        return int(m.group())
    return 0

# Decode all strings
decoded = [decode_custom_b64(s) for s in RAW_STRINGS]
print(f"Total decoded: {len(decoded)} strings")

# Effective indices (after subtracting 0x6d = 109)
INDICES = [0xa1, 0x9b, 0xa3, 0x9c, 0x8c, 0x9a, 0x6d, 0x7b, 0x6f, 0x72, 0x9d]
EFFECTIVE = [idx - 0x6d for idx in INDICES]
TARGET = 709879

def compute_expression(arr):
    vals = [parse_js_int(arr[idx]) for idx in EFFECTIVE]
    result = (-vals[0] / 1.0
              + vals[1] / 2.0 * (vals[2] / 3.0)
              + vals[3] / 4.0
              + (-vals[4] / 5.0) * (-vals[5] / 6.0)
              + vals[6] / 7.0 * (vals[7] / 8.0)
              + vals[8] / 9.0 * (-vals[9] / 10.0)
              + (-vals[10] / 11.0))
    return result

# Try all rotations
for offset in range(len(decoded)):
    rotated = decoded[offset:] + decoded[:offset]
    result = compute_expression(rotated)
    if abs(result - TARGET) < 0.01:
        print(f"\nFOUND at offset {offset}: result = {result}")
        vals = [parse_js_int(rotated[idx]) for idx in EFFECTIVE]
        print(f"  Values at effective indices: {list(zip(EFFECTIVE, vals))}")

        # Now get the API_SALT and compute signature
        api_salt_idx = 0x91 - 0x6d  # 36
        version_idx = 0x83 - 0x6d   # 22

        api_salt = rotated[api_salt_idx]
        version = rotated[version_idx]
        print(f"\n  API_SALT (idx 36): '{api_salt}'")
        print(f"  VERSION (idx 22): '{version}'")

        # Compute signature
        params = {"user": "test123", "action": "login", "from": "web"}
        timestamp = "1700000000"
        sorted_keys = sorted(params.keys())
        param_str = "&".join(f"{k}={params[k]}" for k in sorted_keys)
        sign_str = f"{param_str}|{timestamp}|{api_salt}"
        print(f"\n  Signing string: '{sign_str}'")
        signature = hashlib.md5(sign_str.encode()).hexdigest()
        print(f"  MD5 signature: {signature}")
        break
else:
    print("\nNo matching offset found!")
    # Try to debug
    print("\nChecking which values could be at index 14 (key position for largest term):")
    for offset in range(len(decoded)):
        rotated = decoded[offset:] + decoded[:offset]
        v14 = parse_js_int(rotated[14])
        if v14 > 100000:
            vals = [parse_js_int(rotated[idx]) for idx in EFFECTIVE]
            result = compute_expression(rotated)
            print(f"  offset {offset}: idx14={v14}, result={result}, target_diff={abs(result-TARGET)}")
