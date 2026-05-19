# Vidstorm Stremio Addon

Stremio addon that auto-generates tokens and provides movie/TV streams from Vidstorm.

## Features

- ✅ Auto-generates valid tokens using AES-256-CBC encryption (no browser needed!)
- ✅ Search movies and TV shows via TMDB
- ✅ Multiple stream sources (Lithium, Hydrogen, Boron, etc.)
- ✅ Subtitle support (multi-language)
- ✅ No authentication required

## Installation

### 1. Install Dependencies

```bash
cd stremio-addon
npm install
```

### 2. Start the Addon

```bash
npm start
```

Server runs on `http://localhost:7000`

### 3. Add to Stremio

**Option A: Direct URL**
1. Open Stremio
2. Go to **Addons**
3. Click **Add addon**
4. Enter: `http://localhost:7000/manifest.json`

**Option B: Using stremio:// protocol**
```
stremio://localhost:7000/manifest.json
```

## How It Works

The addon replicates the exact token generation algorithm from Vidstorm's JavaScript:

1. **AES-256-CBC Encryption** with hardcoded key
2. **Plaintext format**: Just the TMDB ID (e.g., `"557"`)
3. **Base64url encoding** to create the token
4. **API call** to `https://vidstorm.ru/api/movie/{token}`

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `/manifest.json` | Addon manifest |
| `/catalog/movie/vidstorm-popular.json` | Popular movies catalog |
| `/catalog/series/vidstorm-tv.json` | TV shows catalog |
| `/meta/movie/tmdb:{id}.json` | Movie metadata |
| `/stream/movie/tmdb:{id}.json` | Stream URLs |
| `/stream/series/tmdb:{id}:{season}:{episode}.json` | TV episode streams |

## Testing

```bash
# Get addon manifest
curl http://localhost:7000/manifest.json

# Search for movies
curl "http://localhost:7000/catalog/movie/vidstorm-popular.json?search=spider+man"

# Get streams for Spider-Man (TMDB ID: 557)
curl http://localhost:7000/stream/movie/tmdb:557.json
```

## Dependencies

- `stremio-addon-sdk` - Stremio addon framework
- `axios` - HTTP client
- `crypto-js` - AES encryption

## Notes

- Tokens are generated server-side (no browser automation needed)
- Streams expire after some time (Stremio will refresh automatically)
- Subtitles are loaded from Vidstorm's subtitle CDN
