#!/usr/bin/env python3
"""
Vidstorm Stream Fetcher - Uses headless browser to extract working tokens
This is the ONLY reliable way to get streams since server-side tokens get 403
"""

import json
import re
import requests
from urllib.parse import urljoin

# Try to import playwright
try:
    from playwright.sync_api import sync_playwright
    PLAYWRIGHT_AVAILABLE = True
except ImportError:
    PLAYWRIGHT_AVAILABLE = False
    print("Playwright not installed. Run: pip install playwright")
    print("Then: playwright install chromium")


class VidstormStreamFetcher:
    """Fetches vidstorm streams using headless browser for token extraction"""
    
    TMDB_API_KEY = "54e00466a09676df57ba51c4ca30b1a6"
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
    
    def get_tmdb_metadata(self, tmdb_id: str):
        """Fetch movie metadata from TMDB"""
        try:
            url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={self.TMDB_API_KEY}"
            resp = self.session.get(url, timeout=10)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            print(f"TMDB error: {e}")
        return None
    
    def extract_token_with_browser(self, tmdb_id: str):
        """
        Use headless browser to extract working token from vidstorm
        This is the ONLY reliable method - server-generated tokens get 403
        """
        if not PLAYWRIGHT_AVAILABLE:
            print("ERROR: Playwright not available. Install it first.")
            return None
        
        try:
            with sync_playwright() as p:
                # Launch browser
                browser = p.chromium.launch(headless=True)
                context = browser.new_context(
                    user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
                )
                page = context.new_page()
                
                # Store captured token
                captured_token = None
                
                # Intercept network requests to capture the token
                def handle_route(route, request):
                    nonlocal captured_token
                    url = request.url
                    
                    # Look for /api/movie/ or /api/tv/ requests
                    match = re.search(r'/api/(?:movie|tv)/([A-Za-z0-9_-]{20,40})', url)
                    if match and not captured_token:
                        captured_token = match.group(1)
                        print(f"[Browser] Captured token: {captured_token}")
                    
                    route.continue_()
                
                page.route("**/*", handle_route)
                
                # Navigate to movie page
                movie_url = f"https://vidstorm.ru/movie/{tmdb_id}"
                print(f"[Browser] Loading {movie_url}...")
                
                try:
                    page.goto(movie_url, wait_until="networkidle", timeout=30000)
                except Exception as e:
                    print(f"[Browser] Page load timeout (expected): {e}")
                
                # Wait a bit for API calls
                page.wait_for_timeout(5000)
                
                # Also try to extract from page content
                if not captured_token:
                    try:
                        content = page.content()
                        match = re.search(r'/api/movie/([A-Za-z0-9_-]{20,40})', content)
                        if match:
                            captured_token = match.group(1)
                            print(f"[Browser] Extracted token from HTML: {captured_token}")
                    except:
                        pass
                
                browser.close()
                return captured_token
                
        except Exception as e:
            print(f"[Browser] Error: {e}")
            return None
    
    def fetch_streams(self, tmdb_id: str, token: str = None):
        """
        Fetch streams for a movie
        If no token provided, uses browser to extract one
        """
        result = {
            "movie_id": tmdb_id,
            "token": token,
            "sources": [],
            "subtitles": [],
            "metadata": None
        }
        
        # Get TMDB metadata
        metadata = self.get_tmdb_metadata(tmdb_id)
        if metadata:
            result["metadata"] = {
                "title": metadata.get("title"),
                "overview": metadata.get("overview"),
                "poster": f"https://image.tmdb.org/t/p/w500{metadata.get('poster_path')}" if metadata.get('poster_path') else None,
                "release_date": metadata.get("release_date"),
                "runtime": metadata.get("runtime")
            }
        
        # If no token, extract with browser
        if not token:
            print(f"[Stream Fetcher] No token provided, extracting with browser...")
            token = self.extract_token_with_browser(tmdb_id)
            if token:
                result["token"] = token
                result["token_source"] = "browser"
            else:
                result["error"] = "Failed to extract token with browser"
                return result
        else:
            result["token_source"] = "provided"
        
        # Fetch streams with the token
        api_url = f"https://vidstorm.ru/api/movie/{token}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "*/*",
            "Referer": f"https://vidstorm.ru/movie/{tmdb_id}",
            "Origin": "https://vidstorm.ru"
        }
        
        try:
            print(f"[Stream Fetcher] Fetching streams from API...")
            resp = self.session.get(api_url, headers=headers, timeout=15)
            print(f"[Stream Fetcher] API status: {resp.status_code}")
            
            if resp.status_code == 200:
                data = resp.json()
                print(f"[Stream Fetcher] Got {len(data)} sources")
                
                for name, source in data.items():
                    if isinstance(source, dict) and source.get('url'):
                        result["sources"].append({
                            "name": name,
                            "url": source['url'],
                            "type": source.get('type', 'hls'),
                            "language": source.get('language'),
                            "quality": self._extract_quality(source['url'])
                        })
            else:
                result["error"] = f"API returned {resp.status_code}"
                
        except Exception as e:
            result["error"] = str(e)
        
        # Fetch subtitles
        try:
            sub_url = f"https://sub.vdrk.site/v2/movie/{tmdb_id}"
            resp = self.session.get(sub_url, timeout=10)
            if resp.status_code == 200:
                result["subtitles"] = resp.json()
        except:
            pass
        
        return result
    
    def _extract_quality(self, url: str):
        """Try to extract quality from stream URL"""
        patterns = [
            r'(\d+)p',
            r'(?:^|/)(\d+)[xX]',
            r'(?:^|[_-])(\d+)[xX]'
        ]
        for pattern in patterns:
            match = re.search(pattern, url)
            if match:
                return match.group(1) + "p"
        return "unknown"


def main():
    """CLI interface"""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python stream_fetcher.py <tmdb_id> [token]")
        print("Examples:")
        print("  python stream_fetcher.py 557")
        print("  python stream_fetcher.py 557 TWkB6xPDtW-pyk5ryfskpQ")
        return
    
    tmdb_id = sys.argv[1]
    token = sys.argv[2] if len(sys.argv) > 2 else None
    
    fetcher = VidstormStreamFetcher()
    result = fetcher.fetch_streams(tmdb_id, token)
    
    print("\n" + "="*60)
    print("RESULT:")
    print("="*60)
    print(json.dumps(result, indent=2))
    
    if result.get("sources"):
        print(f"\n✅ Found {len(result['sources'])} stream sources!")
        for src in result["sources"]:
            print(f"  - {src['name']}: {src['quality']} - {src['url'][:60]}...")
    else:
        print("\n❌ No stream sources found")
        if result.get("error"):
            print(f"Error: {result['error']}")


if __name__ == "__main__":
    main()
