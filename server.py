#!/usr/bin/env python3
"""
Vidstorm Live Resolver - HTTP API Server
Provides a REST API to resolve vidstorm streams
"""

import json
import re
import requests
import base64
from urllib.parse import urljoin, unquote
from http.server import HTTPServer, BaseHTTPRequestHandler
import threading

try:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import pad
    CRYPTO_AVAILABLE = True
except ImportError:
    CRYPTO_AVAILABLE = False


class VidstormAPI:
    """Backend API for resolving vidstorm streams"""
    
    HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36 Edg/148.0.0.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
    }
    
    TMDB_API_KEY = "54e00466a09676df57ba51c4ca30b1a6"
    
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(self.HEADERS)
    
    def get_tmdb_metadata(self, tmdb_id: str):
        """Fetch movie metadata from TMDB"""
        try:
            url = f"https://api.themoviedb.org/3/movie/{tmdb_id}?api_key={self.TMDB_API_KEY}"
            resp = self.session.get(url, timeout=10)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            print(f"TMDB fetch error: {e}")
        return None
    
    def extract_encoded_id(self, tmdb_id: str):
        """Extract encoded ID from vidstorm movie page"""
        try:
            # Visit the movie page
            url = f"https://vidstorm.ru/movie/{tmdb_id}"
            headers = {
                **self.HEADERS,
                "Referer": "https://vidstorm.ru/",
                "Origin": "https://vidstorm.ru"
            }
            
            resp = self.session.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                content = resp.text
                
                # Look for encoded ID patterns in the page
                # Pattern 1: Direct API call in JavaScript
                pattern1 = r'/api/movie/([A-Za-z0-9_-]{20,40})'
                match = re.search(pattern1, content)
                if match:
                    return match.group(1)
                
                # Pattern 2: JSON data in script tags
                pattern2 = r'"movieId"\s*:\s*"([A-Za-z0-9_-]{20,40})"'
                match = re.search(pattern2, content)
                if match:
                    return match.group(1)
                
                # Pattern 3: window.__INITIAL_STATE__ or similar
                pattern3 = r'"streamId"\s*:\s*"([A-Za-z0-9_-]{20,40})"'
                match = re.search(pattern3, content)
                if match:
                    return match.group(1)
                    
        except Exception as e:
            print(f"Extract encoded ID error: {e}")
        return None
    
    def generate_encoded_id(self, tmdb_id: str, media_type: str = "movie", season: int = None, episode: int = None):
        """
        Generate encoded ID using AES-256-CBC encryption with hardcoded key.
        This WORKS server-side and produces valid tokens!
        """
        if not CRYPTO_AVAILABLE:
            return None
        
        try:
            # Hardcoded key from JavaScript
            key = b"x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9"
            iv = key[:16]
            
            # Plaintext is just the TMDB ID (or tv/ID_season_episode for TV)
            if media_type == "tv" and season is not None and episode is not None:
                plaintext = f"tv/{tmdb_id}_{season}_{episode}"
            else:
                plaintext = str(tmdb_id)
            
            # AES-256-CBC encryption
            cipher = AES.new(key, AES.MODE_CBC, iv)
            ciphertext = cipher.encrypt(pad(plaintext.encode(), AES.block_size))
            
            # Base64url encode
            encoded_id = base64.b64encode(ciphertext).decode().replace("+", "-").replace("/", "_").rstrip("=")
            
            print(f"[Token Gen] Generated: {encoded_id} for '{plaintext}'")
            return encoded_id
            
        except Exception as e:
            print(f"[Token Gen] Error: {e}")
            return None
    
    def get_fresh_token(self):
        """Try to get a fresh session token from vidstorm"""
        try:
            # Method 1: Visit homepage to establish session
            headers = {
                **self.HEADERS,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            }
            
            # First, visit the homepage
            home_resp = self.session.get("https://vidstorm.ru/", headers=headers, timeout=10, allow_redirects=True)
            print(f"Homepage status: {home_resp.status_code}")
            
            # Check cookies received
            cookies = self.session.cookies.get_dict()
            print(f"Cookies received: {list(cookies.keys())}")
            
            # Method 2: Try visiting a popular movie page to get token in response
            # Use a well-known movie (Spider-Man = 557)
            test_movie_id = "557"
            movie_url = f"https://vidstorm.ru/movie/{test_movie_id}"
            
            movie_headers = {
                **self.HEADERS,
                "Referer": "https://vidstorm.ru/",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            }
            
            resp = self.session.get(movie_url, headers=movie_headers, timeout=15, allow_redirects=True)
            print(f"Movie page status: {resp.status_code}")
            
            if resp.status_code == 200:
                content = resp.text
                
                # Try multiple patterns to find the token
                patterns = [
                    r'/api/movie/([A-Za-z0-9_-]{20,40})',
                    r'"movieId"\s*:\s*"([A-Za-z0-9_-]{20,40})"',
                    r'"streamId"\s*:\s*"([A-Za-z0-9_-]{20,40})"',
                    r'"token"\s*:\s*"([A-Za-z0-9_-]{20,40})"',
                    r'data-movie-id="([A-Za-z0-9_-]{20,40})"',
                    r'"id"\s*:\s*"([A-Za-z0-9_-]{20,40})"[^}]*movie',
                ]
                
                for pattern in patterns:
                    match = re.search(pattern, content, re.IGNORECASE)
                    if match:
                        token = match.group(1)
                        return {
                            "token": token,
                            "source": "movie_page",
                            "pattern": pattern,
                            "cookies": list(cookies.keys()),
                            "test_url": movie_url
                        }
                
                # If no token found, return debug info
                return {
                    "error": "No token found in page",
                    "page_length": len(content),
                    "cookies": list(cookies.keys()),
                    "page_sample": content[:500] if content else None
                }
            else:
                return {
                    "error": f"Failed to fetch movie page: HTTP {resp.status_code}",
                    "cookies": list(cookies.keys())
                }
                
        except Exception as e:
            return {
                "error": str(e),
                "type": type(e).__name__
            }
    
    def resolve_movie(self, movie_id: str, encoded_id: str = None):
        """Resolve all streams for a movie"""
        result = {
            "movie_id": movie_id,
            "encoded_id": encoded_id,
            "sources": [],
            "subtitles": [],
            "tmdb_metadata": None
        }
        
        # Fetch TMDB metadata
        tmdb_data = self.get_tmdb_metadata(movie_id)
        if tmdb_data:
            result["tmdb_metadata"] = {
                "title": tmdb_data.get("title"),
                "original_title": tmdb_data.get("original_title"),
                "overview": tmdb_data.get("overview"),
                "poster_path": f"https://image.tmdb.org/t/p/w500{tmdb_data.get('poster_path')}" if tmdb_data.get('poster_path') else None,
                "backdrop_path": f"https://image.tmdb.org/t/p/original{tmdb_data.get('backdrop_path')}" if tmdb_data.get('backdrop_path') else None,
                "release_date": tmdb_data.get("release_date"),
                "runtime": tmdb_data.get("runtime"),
                "vote_average": tmdb_data.get("vote_average"),
                "imdb_id": tmdb_data.get("imdb_id")
            }
        
        # If no encoded_id provided, try to extract or generate it
        if not encoded_id:
            # Method 1: Try to extract from page
            encoded_id = self.extract_encoded_id(movie_id)
            if encoded_id:
                result["encoded_id"] = encoded_id
                result["encoded_id_source"] = "auto-extracted"
            else:
                # Method 2: Generate using AES encryption (reverse-engineered from JS)
                generated_id = self.generate_encoded_id(movie_id)
                if generated_id:
                    encoded_id = generated_id
                    result["encoded_id"] = encoded_id
                    result["encoded_id_source"] = "generated"
                else:
                    result["notice"] = "Auto-extraction and generation failed. Install pycryptodome: pip install pycryptodome"
        
        # Fetch stream sources
        if encoded_id:
            api_url = f"https://vidstorm.ru/api/movie/{encoded_id}"
            try:
                headers = {
                    **self.HEADERS,
                    "Accept": "*/*",
                    "Referer": f"https://vidstorm.ru/movie/{movie_id}",
                    "Origin": "https://vidstorm.ru",
                    "Sec-Fetch-Dest": "empty",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Site": "same-origin"
                }
                print(f"[DEBUG] Fetching streams from: {api_url}")
                resp = self.session.get(api_url, headers=headers, timeout=15)
                print(f"[DEBUG] Stream API status: {resp.status_code}")
                if resp.status_code == 200:
                    data = resp.json()
                    print(f"[DEBUG] Stream API response keys: {list(data.keys())}")
                    print(f"[DEBUG] First source sample: {list(data.values())[0] if data else 'empty'}")
                    for name, source in data.items():
                        print(f"[DEBUG] Processing source '{name}': type={type(source)}, has_url={bool(source.get('url') if isinstance(source, dict) else False)}")
                        if isinstance(source, dict) and source.get('url'):
                            result["sources"].append({
                                "name": name,
                                "url": source['url'],
                                "type": source.get('type', 'unknown'),
                                "language": source.get('language'),
                                "flag": source.get('flag')
                            })
                            print(f"[DEBUG] Added source: {name} -> {source['url'][:50]}...")
                else:
                    print(f"[DEBUG] Stream API error: {resp.status_code} - {resp.text[:200]}")
                    result["stream_api_error"] = f"HTTP {resp.status_code}"
            except Exception as e:
                print(f"[DEBUG] Stream fetch exception: {e}")
                result["error"] = str(e)
        
        # Fetch subtitles
        sub_urls = [
            f"https://sub.vdrk.site/v2/movie/{movie_id}",
            f"https://sub.vdrk.site/v1/movie/{movie_id}",
        ]
        
        for sub_url in sub_urls:
            try:
                resp = self.session.get(sub_url, timeout=10)
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, list):
                        result["subtitles"].extend(data)
                    break
            except:
                continue
        
        return result
    
    def resolve_hls(self, master_url: str):
        """Resolve HLS master playlist to variants"""
        variants = []
        
        try:
            resp = self.session.get(master_url, timeout=10)
            if resp.status_code != 200:
                return {"error": f"HTTP {resp.status_code}"}
            
            content = resp.text
            base_url = master_url.rsplit('/', 1)[0] + '/'
            
            lines = content.strip().split('\n')
            current = {}
            
            for line in lines:
                line = line.strip()
                
                if line.startswith('#EXT-X-STREAM-INF:'):
                    current = {
                        "info": line,
                        "resolution": self._extract_attr(line, 'RESOLUTION'),
                        "bandwidth": self._extract_attr(line, 'BANDWIDTH'),
                    }
                elif line and not line.startswith('#') and current:
                    current['path'] = line
                    current['url'] = line if line.startswith('http') else urljoin(base_url, line)
                    variants.append(current)
                    current = {}
            
            return {"variants": variants, "raw": content}
            
        except Exception as e:
            return {"error": str(e)}
    
    def _extract_attr(self, line: str, attr: str):
        """Extract attribute from HLS tag"""
        pattern = rf'{attr}=([^,\s]+)'
        match = re.search(pattern, line)
        return match.group(1) if match else None
    
    def proxy_request(self, url: str, headers: dict = None):
        """Proxy a request to bypass CORS"""
        try:
            h = dict(self.HEADERS)
            
            # For stream/CDN requests, add browser-like headers
            if 'storrrrrrm.site' in url or 'vdrk.site' in url or 'tiktokcdn' in url:
                h.update({
                    "Origin": "https://vidstorm.ru",
                    "Referer": headers.get("Referer", "https://vidstorm.ru/"),
                    "Sec-Fetch-Dest": "empty",
                    "Sec-Fetch-Mode": "cors",
                    "Sec-Fetch-Site": "cross-site",
                    "Accept": "*/*"
                })
            
            if headers:
                h.update(headers)
            
            # Don't use stream=True for HLS playlists so we get proper content
            is_hls = '.m3u8' in url
            resp = self.session.get(url, headers=h, timeout=30, stream=not is_hls)
            
            content = resp.content
            
            # Debug: Log first 200 chars of text content
            if is_hls or 'text' in resp.headers.get('Content-Type', '') or url.endswith('.m3u8'):
                preview = content[:200].decode('utf-8', errors='replace')
                print(f"[Proxy] HLS preview: {preview}")
            
            return {
                "status": resp.status_code,
                "headers": dict(resp.headers),
                "content": content,
                "text": resp.text if 'text' in resp.headers.get('Content-Type', '') else None
            }
        except Exception as e:
            print(f"[Proxy] Error: {e}")
            return {"error": str(e), "status": 500}


class RequestHandler(BaseHTTPRequestHandler):
    """HTTP Request Handler"""
    
    api = VidstormAPI()
    
    def log_message(self, format, *args):
        """Suppress default logging"""
        pass
    
    def _cors_headers(self):
        """Add CORS headers"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    
    def _json_response(self, data: dict, status: int = 200):
        """Send JSON response"""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self._cors_headers()
        self.end_headers()
        self.wfile.write(json.dumps(data, indent=2).encode())
    
    def _rewrite_hls_playlist(self, content: bytes, base_url: str, movie_id: str = None) -> bytes:
        """Rewrite HLS playlist to use proxy URLs for all segments"""
        try:
            text = content.decode('utf-8')
            lines = text.split('\n')
            rewritten = []
            
            for line in lines:
                line = line.strip()
                if not line or line.startswith('#'):
                    # Keep comments and empty lines as-is
                    rewritten.append(line)
                elif line.startswith('http'):
                    # Absolute URL - proxy it
                    movie_param = f"&movie_id={movie_id}" if movie_id else ""
                    proxy_url = f"/proxy?url={line}{movie_param}"
                    rewritten.append(proxy_url)
                else:
                    # Relative URL - resolve and proxy it
                    absolute_url = urljoin(base_url, line)
                    movie_param = f"&movie_id={movie_id}" if movie_id else ""
                    proxy_url = f"/proxy?url={absolute_url}{movie_param}"
                    rewritten.append(proxy_url)
            
            return '\n'.join(rewritten).encode('utf-8')
        except Exception as e:
            print(f"[Proxy] HLS rewrite error: {e}")
            return content
    
    def _proxy_response(self, result: dict, movie_id: str = None, base_url: str = None):
        """Send proxied response"""
        if "error" in result:
            self._json_response(result, 500)
            return
        
        self.send_response(result.get("status", 200))
        
        # Forward content headers
        headers = result.get("headers", {})
        content_type = headers.get('Content-Type', '')
        
        # Check if this is an HLS playlist
        is_hls = 'mpegurl' in content_type or '.m3u8' in (base_url or '')
        
        for key in ['Content-Type', 'Cache-Control']:
            if key in headers:
                self.send_header(key, headers[key])
        
        self._cors_headers()
        self.end_headers()
        
        if result.get("content"):
            content = result["content"]
            
            # Rewrite HLS playlists to use proxy URLs
            if is_hls and base_url:
                content = self._rewrite_hls_playlist(content, base_url, movie_id)
                print(f"[Proxy] Rewrote HLS playlist ({len(content)} bytes)")
            
            self.wfile.write(content)
    
    def do_OPTIONS(self):
        """Handle CORS preflight"""
        self.send_response(200)
        self._cors_headers()
        self.end_headers()
    
    def do_GET(self):
        """Handle GET requests"""
        path = self.path
        print(f"[DEBUG] Received request: {path}")
        
        # API: Resolve movie by TMDB ID
        # /api/movie/{tmdb_id} or /api/movie/{tmdb_id}?encoded={encoded_id}
        match = re.match(r'/api/movie/(\d+)(?:\?encoded=([^&]+))?', path)
        if match:
            movie_id = match.group(1)
            encoded_id = match.group(2)
            if encoded_id:
                encoded_id = unquote(encoded_id)
            
            result = self.api.resolve_movie(movie_id, encoded_id)
            self._json_response(result)
            return
        
        # API: Search/resolve by IMDB ID
        # /api/imdb/{imdb_id}
        match = re.match(r'/api/imdb/(tt\d+)', path)
        if match:
            imdb_id = match.group(1)
            # Search TMDB for this IMDB ID
            try:
                search_url = f"https://api.themoviedb.org/3/find/{imdb_id}?api_key={self.api.TMDB_API_KEY}&external_source=imdb_id"
                resp = requests.get(search_url, timeout=10)
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get('movie_results') and len(data['movie_results']) > 0:
                        tmdb_id = data['movie_results'][0]['id']
                        result = self.api.resolve_movie(str(tmdb_id))
                        result['imdb_id'] = imdb_id
                        result['tmdb_id'] = tmdb_id
                        self._json_response(result)
                        return
                self._json_response({"error": "Movie not found for IMDB ID", "imdb_id": imdb_id}, 404)
            except Exception as e:
                self._json_response({"error": str(e)}, 500)
            return
        
        # API: Resolve HLS playlist
        # /api/hls?url={master_url}
        match = re.match(r'/api/hls\?url=(.+)', path)
        if match:
            url = unquote(match.group(1))
            result = self.api.resolve_hls(url)
            self._json_response(result)
            return
        
        # Proxy: Stream content
        # /proxy?url={url}&movie_id={tmdb_id}
        match = re.match(r'/proxy\?url=([^&]+)(?:&movie_id=(\d+))?', path)
        if match:
            url = unquote(match.group(1))
            movie_id = match.group(2)
            
            # Build proper headers with movie-specific referer
            headers = {}
            if movie_id:
                headers["Referer"] = f"https://vidstorm.ru/movie/{movie_id}"
            
            # Calculate base URL for HLS rewriting (directory of the m3u8)
            base_url = url.rsplit('/', 1)[0] + '/' if '.m3u8' in url else None
            
            result = self.api.proxy_request(url, headers)
            self._proxy_response(result, movie_id, base_url)
            return
        
        # API: Get fresh session token
        # /api/token - WARNING: Server-fetched tokens may not work for streams
        # Use browser bookmarklet for reliable tokens
        match = re.match(r'/api/token(?:\?.*)?$', path)
        if match:
            print(f"[DEBUG] Token endpoint matched")
            result = self.api.get_fresh_token()
            if result.get("token"):
                result["warning"] = "Server-fetched tokens often return empty streams. Use browser bookmarklet on vidstorm.ru for reliable tokens."
                result["bookmarklet_url"] = "javascript:(function(){const m=document.documentElement.innerHTML.match(/\\/api\\/movie\\/([A-Za-z0-9_-]{20,40})/);if(m){navigator.clipboard.writeText(m[1]).then(()=>alert('Copied: '+m[1])).catch(()=>prompt('Copy this:',m[1]));}else{alert('Not found. Use DevTools.');}})();"
                result["usage"] = f"/api/movie/{{tmdb_id}}?encoded={result['token']}"
            self._json_response(result)
            return
        
        # Health check
        if path == '/health' or path == '/':
            self._json_response({
                "status": "ok",
                "service": "vidstorm-resolver",
                "endpoints": [
                    "GET /api/movie/{tmdb_id} - Resolve by TMDB ID (auto-extracts encoded_id)",
                    "GET /api/movie/{tmdb_id}?encoded={id} - Resolve with explicit encoded ID",
                    "GET /api/imdb/{imdb_id} - Resolve by IMDB ID (tt0000000)",
                    "GET /api/hls?url={master_url} - Parse HLS playlist",
                    "GET /api/token - Get fresh session token from vidstorm",
                    "GET /proxy?url={url} - Proxy stream requests",
                    "GET /health - Health check"
                ],
                "example_tmdb_ids": ["672"],
                "example_imdb_ids": ["tt0295297"]
            })
            return
        
        self._json_response({"error": "Not found"}, 404)


def run_server(port: int = 8080):
    """Run the HTTP server"""
    server = HTTPServer(('0.0.0.0', port), RequestHandler)
    print(f"Vidstorm Resolver Server running on http://localhost:{port}")
    print(f"\nEndpoints:")
    print(f"  http://localhost:{port}/api/movie/672")
    print(f"  http://localhost:{port}/api/movie/672?encoded=TWkB6xPDtW-pyk5ryfskpQ")
    print(f"  http://localhost:{port}/api/imdb/tt0295297")
    print(f"  http://localhost:{port}/api/token              # Get fresh session token")
    print(f"  http://localhost:{port}/api/hls?url=<master.m3u8_url>")
    print(f"  http://localhost:{port}/proxy?url=<stream_url>")
    print(f"\nPress Ctrl+C to stop")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    run_server(port)
