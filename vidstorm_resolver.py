#!/usr/bin/env python3
"""
Vidstorm Live Resolver
Extracts and resolves video stream URLs from vidstorm.ru HAR data
"""

import json
import re
import base64
import requests
from urllib.parse import urljoin, urlparse
from typing import Optional, Dict, List, Any


class VidstormResolver:
    """Resolver for vidstorm.ru video streams"""
    
    BASE_URL = "https://vidstorm.ru"
    API_BASE = "https://vidstorm.ru/api"
    SUBTITLE_BASE = "https://sub.vdrk.site"
    STREAM_BASE = "https://storrrrrrm.site"
    
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Origin": "https://vidstorm.ru",
        "Referer": "https://vidstorm.ru/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
    }
    
    def __init__(self, har_file_path: Optional[str] = None):
        self.har_data = None
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
        
        if har_file_path:
            self.load_har(har_file_path)
    
    def load_har(self, filepath: str) -> None:
        """Load HAR file and extract relevant API patterns"""
        with open(filepath, 'r', encoding='utf-8') as f:
            self.har_data = json.load(f)
        print(f"Loaded HAR file with {len(self.har_data.get('log', {}).get('entries', []))} entries")
    
    def extract_movie_api_pattern(self) -> Optional[Dict]:
        """Extract movie API URL patterns from HAR"""
        if not self.har_data:
            return None
            
        entries = self.har_data['log']['entries']
        
        for entry in entries:
            url = entry.get('request', {}).get('url', '')
            
            # Look for the API endpoint that returns stream URLs
            if '/api/movie/' in url:
                return {
                    'url': url,
                    'method': entry['request']['method'],
                    'headers': {h['name']: h['value'] for h in entry['request'].get('headers', [])}
                }
        return None
    
    def extract_stream_urls(self) -> List[Dict]:
        """Extract all stream URLs from HAR file"""
        if not self.har_data:
            return []
            
        streams = []
        entries = self.har_data['log']['entries']
        
        for entry in entries:
            url = entry.get('request', {}).get('url', '')
            
            # Look for HLS master playlists
            if 'master.m3u8' in url or '.m3u8' in url:
                response = entry.get('response', {})
                content = response.get('content', {})
                
                stream_info = {
                    'url': url,
                    'status': response.get('status'),
                    'content_type': content.get('mimeType'),
                    'text': content.get('text', '')
                }
                streams.append(stream_info)
        
        return streams
    
    def extract_subtitle_urls(self) -> List[Dict]:
        """Extract subtitle URLs from HAR file"""
        if not self.har_data:
            return []
            
        subtitles = []
        entries = self.har_data['log']['entries']
        
        for entry in entries:
            url = entry.get('request', {}).get('url', '')
            
            # Look for subtitle API endpoints
            if '/movie/' in url and 'sub.vdrk.site' in url:
                response = entry.get('response', {})
                content = response.get('content', {})
                text = content.get('text', '')
                
                if text:
                    try:
                        data = json.loads(text)
                        subtitles.append({
                            'url': url,
                            'data': data
                        })
                    except:
                        pass
        
        return subtitles
    
    def resolve_movie_streams(self, movie_id: str, encoded_id: Optional[str] = None) -> Dict:
        """
        Resolve video streams for a given movie ID
        
        Args:
            movie_id: The numeric movie ID (e.g., "672")
            encoded_id: The encoded ID if known (e.g., "TWkB6xPDtW-pyk5ryfskpQ")
        """
        results = {
            'movie_id': movie_id,
            'encoded_id': encoded_id,
            'streams': {},
            'subtitles': [],
            'metadata': None
        }
        
        # Try to fetch movie streams
        if encoded_id:
            api_url = f"{self.API_BASE}/movie/{encoded_id}"
            try:
                resp = self.session.get(api_url, timeout=10)
                if resp.status_code == 200:
                    data = resp.json()
                    results['streams'] = data
                    print(f"Found {len(data)} stream sources")
            except Exception as e:
                print(f"Error fetching streams: {e}")
        
        # Fetch subtitles
        sub_url = f"{self.SUBTITLE_BASE}/v1/movie/{movie_id}"
        try:
            resp = self.session.get(sub_url, timeout=10)
            if resp.status_code == 200:
                results['subtitles'] = resp.json()
                print(f"Found {len(results['subtitles'])} subtitle tracks")
        except Exception as e:
            print(f"Error fetching subtitles: {e}")
        
        return results
    
    def resolve_hls_playlist(self, master_url: str) -> List[Dict]:
        """
        Resolve an HLS master playlist to get quality variants
        """
        variants = []
        
        try:
            resp = self.session.get(master_url, timeout=10)
            if resp.status_code != 200:
                return variants
            
            content = resp.text
            base_url = master_url.rsplit('/', 1)[0] + '/'
            
            # Parse master.m3u8
            lines = content.strip().split('\n')
            current_variant = {}
            
            for line in lines:
                line = line.strip()
                
                if line.startswith('#EXT-X-STREAM-INF:'):
                    # Parse stream info
                    current_variant = {'info': line}
                    
                    # Extract resolution
                    res_match = re.search(r'RESOLUTION=(\d+x\d+)', line)
                    if res_match:
                        current_variant['resolution'] = res_match.group(1)
                    
                    # Extract bandwidth
                    bw_match = re.search(r'BANDWIDTH=(\d+)', line)
                    if bw_match:
                        current_variant['bandwidth'] = int(bw_match.group(1))
                
                elif line and not line.startswith('#') and current_variant:
                    # This is a variant URL
                    variant_url = line if line.startswith('http') else urljoin(base_url, line)
                    current_variant['url'] = variant_url
                    variants.append(current_variant)
                    current_variant = {}
            
            print(f"Found {len(variants)} quality variants")
            
        except Exception as e:
            print(f"Error resolving HLS playlist: {e}")
        
        return variants
    
    def get_stream_segments(self, variant_url: str) -> List[str]:
        """
        Get segment URLs from a variant playlist
        """
        segments = []
        
        try:
            resp = self.session.get(variant_url, timeout=10)
            if resp.status_code != 200:
                return segments
            
            content = resp.text
            base_url = variant_url.rsplit('/', 1)[0] + '/'
            
            for line in content.strip().split('\n'):
                line = line.strip()
                if line and not line.startswith('#'):
                    seg_url = line if line.startswith('http') else urljoin(base_url, line)
                    segments.append(seg_url)
            
            print(f"Found {len(segments)} segments")
            
        except Exception as e:
            print(f"Error getting segments: {e}")
        
        return segments
    
    def print_summary(self, movie_id: str = "672"):
        """Print a summary of extracted information from HAR"""
        print("=" * 60)
        print("VIDSTORM HAR ANALYSIS SUMMARY")
        print("=" * 60)
        
        # Extract patterns
        api_pattern = self.extract_movie_api_pattern()
        if api_pattern:
            print(f"\n[API Pattern Found]")
            print(f"  URL: {api_pattern['url']}")
        
        # Stream URLs
        streams = self.extract_stream_urls()
        if streams:
            print(f"\n[Stream URLs Found: {len(streams)}]")
            for i, s in enumerate(streams[:5], 1):
                print(f"  {i}. {s['url'][:80]}...")
                if s.get('text'):
                    print(f"     Content: {s['text'][:100]}...")
        
        # Subtitles
        subs = self.extract_subtitle_urls()
        if subs:
            print(f"\n[Subtitle Sources Found: {len(subs)}]")
            for s in subs[:3]:
                if isinstance(s.get('data'), list):
                    print(f"  - {s['url']}: {len(s['data'])} tracks")
        
        print("\n" + "=" * 60)


def main():
    """Main entry point"""
    import sys
    
    har_path = r"c:\Users\Lester Allen\Downloads\wstormm.har"
    
    resolver = VidstormResolver(har_path)
    
    # Print HAR analysis
    resolver.print_summary()
    
    # Example: Resolve movie 672 (Harry Potter 2)
    print("\n[LIVE RESOLVER TEST]")
    print("-" * 40)
    
    # From HAR we know the encoded ID for movie 672
    results = resolver.resolve_movie_streams(
        movie_id="672",
        encoded_id="TWkB6xPDtW-pyk5ryfskpQ"
    )
    
    print("\n[Stream Sources]")
    for source, data in results['streams'].items():
        if data.get('url'):
            print(f"  {source}:")
            print(f"    URL: {data['url']}")
            print(f"    Type: {data.get('type', 'unknown')}")
            print(f"    Language: {data.get('language', 'unknown')}")
            
            # If HLS, resolve variants
            if data.get('type') == 'hls' and 'master.m3u8' in data['url']:
                variants = resolver.resolve_hls_playlist(data['url'])
                for v in variants:
                    print(f"    - {v.get('resolution', 'unknown')} @ {v.get('bandwidth', 0)//1000}kbps")
    
    print("\n[Subtitle Tracks]")
    for sub in results['subtitles'][:5]:
        label = sub.get('label', 'unknown')
        file_url = sub.get('file', '')
        print(f"  - {label}: {file_url[:60]}...")


if __name__ == "__main__":
    main()
