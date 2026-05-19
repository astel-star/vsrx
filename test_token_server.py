#!/usr/bin/env python3
"""
Server-side token generator test
Generates token with AES and immediately tests it against vidstorm API
"""

import base64
import requests
import time

try:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import pad
except ImportError:
    print("❌ pycryptodome not installed")
    print("Run: pip install pycryptodome")
    exit(1)

# Hardcoded key from JavaScript
KEY = b"x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9"
IV = KEY[:16]

def generate_token(tmdb_id, format_type="movie"):
    """Generate token with different formats"""
    
    if format_type == "movie_slash":
        plain = f"movie/{tmdb_id}"
    elif format_type == "tv":
        plain = f"tv/{tmdb_id}"
    elif format_type == "tv_season_episode":
        plain = f"tv/{tmdb_id}_1_1"
    elif format_type == "just_id":
        plain = str(tmdb_id)
    else:
        plain = str(tmdb_id)
    
    print(f"\n[Token Gen] Format: {format_type}")
    print(f"[Token Gen] Plaintext: '{plain}'")
    print(f"[Token Gen] Plain hex: {plain.encode().hex()}")
    
    cipher = AES.new(KEY, AES.MODE_CBC, IV)
    ct_bytes = cipher.encrypt(pad(plain.encode(), AES.block_size))
    
    print(f"[Token Gen] Cipher hex: {ct_bytes.hex()}")
    
    # Base64url encode
    token = base64.b64encode(ct_bytes).decode().replace("+", "-").replace("/", "_").rstrip("=")
    print(f"[Token Gen] Token: {token}")
    
    return token

def test_token(tmdb_id, token):
    """Test token against vidstorm API"""
    
    url = f"https://vidstorm.ru/api/movie/{token}"
    print(f"\n[API Test] URL: {url}")
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": f"https://vidstorm.ru/movie/{tmdb_id}",
        "Origin": "https://vidstorm.ru"
    }
    
    try:
        start = time.time()
        resp = requests.get(url, headers=headers, timeout=15)
        elapsed = (time.time() - start) * 1000
        
        print(f"[API Test] Status: {resp.status_code} ({elapsed:.0f}ms)")
        
        if resp.status_code == 200:
            data = resp.json()
            source_count = sum(1 for s in data.values() if isinstance(s, dict) and s.get('url'))
            total_count = len(data)
            
            print(f"[API Test] Total entries: {total_count}")
            print(f"[API Test] Sources with URLs: {source_count}")
            
            if source_count > 0:
                print(f"\n✅ SUCCESS! Token works!")
                for name, source in data.items():
                    if isinstance(source, dict) and source.get('url'):
                        print(f"\n  {name}:")
                        print(f"    URL: {source['url'][:80]}...")
                        print(f"    Type: {source.get('type', 'unknown')}")
                        print(f"    Language: {source.get('language', 'unknown')}")
                return True
            else:
                print(f"\n❌ Token accepted but no stream URLs")
                # Show sample of what was returned
                for name, source in list(data.items())[:3]:
                    print(f"  {name}: {source}")
                return False
        else:
            print(f"\n❌ API error: {resp.status_code}")
            print(f"Response: {resp.text[:200]}")
            return False
            
    except Exception as e:
        print(f"\n❌ Request failed: {e}")
        return False

def main():
    import sys
    
    tmdb_id = sys.argv[1] if len(sys.argv) > 1 else "557"
    
    print("="*70)
    print(f"SERVER-SIDE TOKEN TEST - TMDB ID: {tmdb_id}")
    print("="*70)
    
    # Test different formats
    formats_to_test = [
        "just_id",           # "557"
        "movie_slash",       # "movie/557"
        "tv",                # "tv/557"
    ]
    
    for fmt in formats_to_test:
        print("\n" + "="*70)
        print(f"TESTING FORMAT: {fmt}")
        print("="*70)
        
        token = generate_token(tmdb_id, fmt)
        success = test_token(tmdb_id, token)
        
        if success:
            print(f"\n🎉 WORKING FORMAT FOUND: {fmt}")
            print(f"Token: {token}")
            break
        
        time.sleep(1)  # Don't hammer the API
    
    print("\n" + "="*70)
    print("TEST COMPLETE")
    print("="*70)

if __name__ == "__main__":
    main()
