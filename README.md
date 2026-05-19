# Vidstorm Live Resolver

A live resolver tool for extracting and playing video streams from vidstorm.ru using **TMDB ID** - no HAR file needed!

## Features

- ✅ **TMDB ID Input** - Just enter the TMDB movie ID
- ✅ **IMDB ID Support** - Resolve by IMDB ID (tt0000000)
- ✅ **Auto Extraction** - Automatically extracts encoded stream ID from vidstorm
- ✅ **TMDB Metadata** - Fetches movie info, posters, ratings
- ✅ **Web Player** - Built-in HLS player with quality selection
- ✅ **CORS Proxy** - Built-in proxy for cross-origin stream playback

## Files

| File | Description |
|------|-------------|
| `server.py` | HTTP API server (start this first) |
| `player.html` | Web player UI with HLS.js |
| `test_api.py` | Test script for API endpoints |
| `vidstorm_resolver.py` | Legacy HAR analyzer (optional) |
| `requirements.txt` | Python dependencies |

## Quick Start

### 1. Start the Server
```bash
pip install requests
python server.py 8080
```

### 2. Open the Player
Open `player.html` in your browser or test via curl:

```bash
# Resolve by TMDB ID (auto-extracts stream ID)
curl "http://localhost:8080/api/movie/672"

# Resolve by IMDB ID
curl "http://localhost:8080/api/imdb/tt0295297"

# With explicit encoded ID (if auto-extraction fails)
curl "http://localhost:8080/api/movie/672?encoded=TWkB6xPDtW-pyk5ryfskpQ"
```

## API Endpoints

### GET /api/movie/{tmdb_id}
Resolve streams by TMDB ID. Auto-extracts the encoded stream ID from vidstorm.

```json
{
  "movie_id": "672",
  "encoded_id": "TWkB6xPDtW-pyk5ryfskpQ",
  "encoded_id_source": "auto-extracted",
  "tmdb_metadata": {
    "title": "Harry Potter and the Chamber of Secrets",
    "poster_path": "https://image.tmdb.org/t/p/w500/...",
    "imdb_id": "tt0295297",
    "release_date": "2002-11-13",
    "runtime": 161
  },
  "sources": [
    {
      "name": "Lithium",
      "url": "https://storrrrrrm.site/stream/.../master.m3u8",
      "type": "hls",
      "language": "English"
    }
  ],
  "subtitles": [
    {"label": "English", "file": "https://cache.vdrk.site/.../English.vtt"}
  ]
}
```

### GET /api/imdb/{imdb_id}
Resolve by IMDB ID (e.g., `tt0295297`).

### GET /api/hls?url={master_url}
Parse HLS master playlist to get quality variants.

### GET /proxy?url={stream_url}
Proxy any stream URL to bypass CORS in browsers.

## Web Player Usage

1. Enter a **TMDB Movie ID** (e.g., `672` for Harry Potter 2)
2. Click **Resolve Streams**
3. The encoded ID is auto-detected
4. Click **Play** on any source
5. Select quality/subtitles from dropdowns

### URL Parameters
```
player.html?movie=672              # Resolve by TMDB ID
player.html?movie=672&encoded=xxx  # With explicit encoded ID
player.html?imdb=tt0295297         # Resolve by IMDB ID
```

## Finding TMDB IDs

1. Go to [themoviedb.org](https://www.themoviedb.org)
2. Search for your movie
3. The ID is in the URL: `/movie/672-harry-potter-and-the-chamber-of-secrets`
4. Use `672` as the ID

## Example Movies

| TMDB ID | IMDB ID | Title |
|---------|---------|-------|
| 672 | tt0295297 | Harry Potter and the Chamber of Secrets |
| 671 | tt0241527 | Harry Potter and the Philosopher's Stone |
| 673 | tt0304140 | Harry Potter and the Prisoner of Azkaban |
| 550 | tt0137523 | Fight Club |
| 155 | tt0468569 | The Dark Knight |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  Web Player │────▶│  Resolver    │────▶│  vidstorm.ru    │
│  (player.html)    │  (server.py) │     │  (scrapes ID)   │
└─────────────┘     └──────────────┘     └─────────────────┘
                           │
           ┌───────────────┼───────────────┐
           ▼               ▼               ▼
      ┌─────────┐    ┌──────────┐   ┌──────────┐
      │  TMDB   │    │  Stream  │   │  Subtitle│
      │  API    │    │   CDN    │   │   API    │
      └─────────┘    └──────────┘   └──────────┘
```

## How It Works

1. User provides TMDB ID (e.g., `672`)
2. Server visits `https://vidstorm.ru/movie/672`
3. Scrapes the page to find encoded stream ID
4. Calls vidstorm API with encoded ID to get stream URLs
5. Fetches TMDB metadata for movie info
6. Returns combined data to player

## Notes

- **Auto-extraction often fails** due to vidstorm's anti-scraping protection
- **Browser bookmarklet is the ONLY reliable method** - server-side token generation doesn't work
- The encoded ID is generated client-side using AES encryption, but includes session/timestamp data we cannot replicate
- Stream tokens are IP-bound and expire quickly (use immediately after extraction)
- Subtitle files are VTT format from `cache.vdrk.site`
- Built-in CORS proxy allows browser playback without extensions

## Troubleshooting: Auto-Extraction Failed?

If the encoded ID can't be auto-extracted, you **must use the Bookmarklet Method**. Server-side token fetching doesn't work reliably because vidstorm requires browser context.

### Why Server Tokens Don't Work

Vidstorm's API returns empty stream URLs when tokens are fetched by the server (even though the API call succeeds). The token must be extracted from a real browser session.

### Method 1: Browser Bookmarklet (RECOMMENDED)

1. **Create bookmark**: Copy this code as a bookmark URL:
```javascript
javascript:(function(){const m=document.documentElement.innerHTML.match(/\/api\/movie\/([A-Za-z0-9_-]{20,40})/);if(m){navigator.clipboard.writeText(m[1]).then(()=>alert('Copied: '+m[1])).catch(()=>prompt('Copy this:',m[1]));}else{alert('Not found. Use DevTools method below.');}})();
```

2. **Use it**: Go to `https://vidstorm.ru/movie/672` → Click bookmark → ID is copied!

3. **Paste**: In `player.html`, paste the encoded ID into the "Encoded ID (optional)" field

### Method 2: DevTools Network Tab

1. Go to `https://vidstorm.ru/movie/672` in your browser
2. Open DevTools (F12) → Network tab
3. Look for request to `/api/movie/XXXXXX` (like your screenshot shows)
4. Copy the `XXXXXX` part after `/api/movie/`
5. Paste into the player

### Testing Server Token (Advanced)

You can try fetching a token from the server, but it likely won't provide valid streams:
```bash
curl "http://localhost:8080/api/token"
```

See `bookmarklet.js` for the full bookmarklet code with more extraction methods.
