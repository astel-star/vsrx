#!/usr/bin/env python3
"""Test the resolver API with TMDB ID support"""

import requests
import sys

BASE_URL = "http://localhost:8080"

def test_health():
    """Test health endpoint"""
    r = requests.get(f"{BASE_URL}/health")
    print(f"Health: {r.status_code}")
    data = r.json()
    print(f"Service: {data.get('service')}")
    print(f"Endpoints: {len(data.get('endpoints', []))}")
    return r.status_code == 200

def test_resolve_tmdb(tmdb_id="672", encoded_id=None):
    """Test movie resolution by TMDB ID (no HAR needed)"""
    url = f"{BASE_URL}/api/movie/{tmdb_id}"
    if encoded_id:
        url += f"?encoded={encoded_id}"
    
    print(f"\n[TMDB ID Test]")
    print(f"Resolving: {url}")
    r = requests.get(url)
    print(f"Status: {r.status_code}")
    
    if r.status_code == 200:
        data = r.json()
        print(f"TMDB ID: {data.get('movie_id')}")
        print(f"Encoded ID: {data.get('encoded_id')} ({data.get('encoded_id_source', 'provided')})")
        print(f"Sources: {len(data.get('sources', []))}")
        print(f"Subtitles: {len(data.get('subtitles', []))}")
        
        # Show TMDB metadata
        meta = data.get('tmdb_metadata', {})
        if meta:
            print(f"\nTitle: {meta.get('title')}")
            print(f"IMDB: {meta.get('imdb_id')}")
            print(f"Year: {meta.get('release_date', '')[:4]}")
        
        for src in data.get('sources', [])[:3]:
            print(f"  - {src['name']}: {src['type']} ({src.get('language', 'unknown')})")
        
        return data
    else:
        print(f"Error: {r.text}")
        return None

def test_resolve_imdb(imdb_id="tt0295297"):
    """Test movie resolution by IMDB ID"""
    url = f"{BASE_URL}/api/imdb/{imdb_id}"
    
    print(f"\n[IMDB ID Test]")
    print(f"Resolving: {url}")
    r = requests.get(url)
    print(f"Status: {r.status_code}")
    
    if r.status_code == 200:
        data = r.json()
        print(f"IMDB ID: {data.get('imdb_id')}")
        print(f"TMDB ID: {data.get('tmdb_id')}")
        print(f"Encoded ID: {data.get('encoded_id')}")
        print(f"Sources: {len(data.get('sources', []))}")
        return data
    else:
        print(f"Error: {r.text}")
        return None

def test_hls_resolve(master_url):
    """Test HLS resolution"""
    url = f"{BASE_URL}/api/hls?url={master_url}"
    print(f"\n[HLS Test]")
    print(f"Resolving: {master_url[:60]}...")
    r = requests.get(url)
    print(f"Status: {r.status_code}")
    
    if r.status_code == 200:
        data = r.json()
        variants = data.get('variants', [])
        print(f"Variants: {len(variants)}")
        for v in variants:
            res = v.get('resolution', 'unknown')
            bw = v.get('bandwidth', 'unknown')
            print(f"  - {res} @ {bw}")
        return data
    return None

def main():
    print("=" * 60)
    print("Vidstorm Resolver API Test - TMDB Edition")
    print("=" * 60)
    
    # Test health
    if not test_health():
        print("Server not running!")
        sys.exit(1)
    
    # Test 1: Resolve by TMDB ID only (auto-extract encoded_id)
    print("\n" + "=" * 60)
    print("Test 1: Resolve by TMDB ID (672 - Harry Potter 2)")
    print("=" * 60)
    data = test_resolve_tmdb("672")
    
    if data and data.get('sources'):
        hls_source = None
        for src in data['sources']:
            if src.get('type') == 'hls' or '.m3u8' in src.get('url', ''):
                hls_source = src['url']
                break
        
        if hls_source:
            test_hls_resolve(hls_source)
    
    # Test 2: Resolve by IMDB ID
    print("\n" + "=" * 60)
    print("Test 2: Resolve by IMDB ID (tt0295297)")
    print("=" * 60)
    test_resolve_imdb("tt0295297")
    
    print("\n" + "=" * 60)
    print("All tests complete!")
    print("=" * 60)

if __name__ == "__main__":
    main()
