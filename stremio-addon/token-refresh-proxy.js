/**
 * Token Refresh Proxy
 * Generates fresh tokens on segment requests to get valid TikTok CDN URLs
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const url = require('url');

const PROXY_PORT = 7001;
const AES_KEY = 'x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9';

// Cache for playlists to reduce API calls
const playlistCache = new Map();
const CACHE_TTL = 25000; // 25 seconds (under 30s expiration)

// AES encryption for token generation
function generateToken(tmdbId, type = 'movie', season = null, episode = null) {
  const timestamp = Math.floor(Date.now() / 1000);
  const baseId = parseInt(tmdbId);
  const transformedId = baseId ^ 9348;
  
  const data = JSON.stringify({
    id: transformedId,
    time: timestamp,
    type: type,
    season: season ? parseInt(season) : null,
    episode: episode ? parseInt(episode) : null
  });
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, iv);
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const token = Buffer.concat([iv, Buffer.from(encrypted, 'base64')]).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  
  return token;
}

// Fetch fresh playlist from VidStorm API
async function fetchFreshPlaylist(tmdbId, type = 'movie', sourceName = 'Lithium') {
  const cacheKey = `${tmdbId}-${type}-${sourceName}`;
  const cached = playlistCache.get(cacheKey);
  
  if (cached && (Date.now() - cached.time) < CACHE_TTL) {
    console.log(`[TokenRefresh] Using cached playlist (${(Date.now() - cached.time)/1000}s old)`);
    return cached.data;
  }
  
  const token = generateToken(tmdbId, type);
  const apiUrl = `https://vidstorm.ru/api/movie/${token}`;
  
  console.log(`[TokenRefresh] Fetching fresh playlist for ${tmdbId}...`);
  
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'vidstorm.ru',
      path: `/api/movie/${token}`,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': `https://vidstorm.ru/movie/${tmdbId}`,
        'Origin': 'https://vidstorm.ru'
      },
      timeout: 15000
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const sources = JSON.parse(data);
          const source = sources[sourceName] || sources.Lithium || Object.values(sources)[0];
          
          if (!source || !source.url) {
            reject(new Error('No stream source found'));
            return;
          }
          
          // Cache the result
          playlistCache.set(cacheKey, {
            data: source.url,
            time: Date.now()
          });
          
          console.log(`[TokenRefresh] Got fresh URL: ${source.url.substring(0, 80)}...`);
          resolve(source.url);
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('API timeout'));
    });
    req.end();
  });
}

// Parse quality from segment URL (e.g., 720p.m3u8 -> 720p)
function parseQuality(url) {
  const match = url.match(/(\d+)p/);
  return match ? match[1] : '720';
}

// Main proxy server
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const targetUrl = parsedUrl.query.url;
  const movieId = parsedUrl.query.movie_id;
  
  if (!targetUrl) {
    res.writeHead(400);
    res.end('Missing url parameter');
    return;
  }
  
  console.log(`\n[TokenRefresh] Request: ${targetUrl.substring(0, 80)}...`);
  
  try {
    // Check if this is a TikTok CDN segment that needs refreshing
    const isTikTokSegment = targetUrl.includes('tiktokcdn.com') && 
                           !targetUrl.includes('.m3u8');
    
    if (isTikTokSegment && movieId) {
      // This is an expired segment - fetch fresh URL
      const quality = parseQuality(targetUrl);
      
      console.log(`[TokenRefresh] Expired TikTok segment detected, fetching fresh ${quality}p stream...`);
      
      const freshPlaylistUrl = await fetchFreshPlaylist(movieId, 'movie', 'Lithium');
      
      // Fetch the quality-specific playlist
      const qualityPlaylistUrl = freshPlaylistUrl.replace('master.m3u8', `${quality}p.m3u8`);
      
      console.log(`[TokenRefresh] Fetching quality playlist: ${qualityPlaylistUrl.substring(0, 80)}...`);
      
      // Fetch the actual segment from the fresh playlist
      // For simplicity, we'll proxy the first segment from the fresh playlist
      // In production, you'd map the segment index
      
      // Just proxy the fresh playlist URL to Stremio
      // Stremio will handle the HLS logic
      const targetParsed = new URL(qualityPlaylistUrl);
      
      const options = {
        hostname: targetParsed.hostname,
        port: 443,
        path: targetParsed.pathname + targetParsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': '*/*',
          'Referer': `https://vidstorm.ru/movie/${movieId}`,
          'Origin': 'https://vidstorm.ru'
        },
        timeout: 30000
      };
      
      const proxyReq = https.request(options, (proxyRes) => {
        console.log(`[TokenRefresh] Fresh playlist response: ${proxyRes.statusCode}`);
        
        res.writeHead(proxyRes.statusCode, {
          'Content-Type': 'application/vnd.apple.mpegurl',
          'Access-Control-Allow-Origin': '*'
        });
        
        proxyRes.pipe(res);
      });
      
      proxyReq.on('error', (err) => {
        console.error(`[TokenRefresh] Error: ${err.message}`);
        res.writeHead(500);
        res.end(`Proxy error: ${err.message}`);
      });
      
      proxyReq.end();
      return;
    }
    
    // For non-TikTok requests, proxy normally
    const targetParsed = new URL(targetUrl);
    const isHttps = targetParsed.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const options = {
      hostname: targetParsed.hostname,
      port: targetParsed.port || (isHttps ? 443 : 80),
      path: targetParsed.pathname + targetParsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': movieId ? `https://vidstorm.ru/movie/${movieId}` : 'https://vidstorm.ru/',
        'Origin': 'https://vidstorm.ru'
      },
      timeout: 30000
    };
    
    const proxyReq = client.request(options, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      const contentLength = proxyRes.headers['content-length'];
      
      console.log(`[TokenRefresh] Upstream response: ${proxyRes.statusCode}, Type: ${contentType}, Size: ${contentLength || 'unknown'}`);
      
      const isHls = contentType.includes('mpegurl') || contentType.includes('m3u8') || targetUrl.includes('.m3u8');
      
      if (isHls) {
        // Rewrite HLS playlist to use this proxy
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
          const movieParam = movieId ? `&movie_id=${movieId}` : '';
          
          console.log(`[TokenRefresh] Original playlist (${data.length} bytes):`);
          console.log(data.substring(0, 200));
          
          // Rewrite all URLs to go through this proxy
          const originalLines = data.split('\n');
          
          // Rewrite absolute URLs (http://...)
          data = data.replace(/^(https?:\/\/[^\s]+)$/gm, (match) => {
            if (match.includes('127.0.0.1:7001') || match.startsWith('data:')) return match;
            return `http://127.0.0.1:7001/proxy?url=${encodeURIComponent(match)}${movieParam}`;
          });
          
          // Rewrite relative URLs (e.g., 536p.m3u8, 720p.m3u8)
          data = data.replace(/^([^#\s][^\s]*)\.m3u8$/gm, (match) => {
            if (match.startsWith('http')) return match; // Already rewritten
            const absoluteUrl = baseUrl + match;
            return `http://127.0.0.1:7001/proxy?url=${encodeURIComponent(absoluteUrl)}${movieParam}`;
          });
          
          const rewrittenLines = data.split('\n');
          console.log(`[TokenRefresh] Rewrote ${originalLines.length} lines -> ${rewrittenLines.length} lines`);
          console.log(`[TokenRefresh] Rewritten playlist:\n${data}`);
          
          res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Content-Length': Buffer.byteLength(data),
            'Access-Control-Allow-Origin': '*'
          });
          res.end(data);
          console.log(`[TokenRefresh] Sent rewritten playlist (${data.length} bytes)`);
        });
        return;
      }
      
      // For video segments, forward with correct content-type
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'video/mp4',
        'Content-Length': proxyRes.headers['content-length'],
        'Accept-Ranges': proxyRes.headers['accept-ranges'],
        'Content-Range': proxyRes.headers['content-range'],
        'Access-Control-Allow-Origin': '*'
      });
      
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
      console.error(`[TokenRefresh] Error: ${err.message}`);
      res.writeHead(500);
      res.end(`Proxy error: ${err.message}`);
    });
    
    proxyReq.end();
    
  } catch (err) {
    console.error(`[TokenRefresh] Error: ${err.message}`);
    res.writeHead(500);
    res.end(`Error: ${err.message}`);
  }
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[TokenRefresh] Proxy running on http://127.0.0.1:${PROXY_PORT}`);
  console.log(`[TokenRefresh] Features: On-the-fly token refresh for expired segments`);
});

process.on('SIGINT', () => {
  console.log('\n[TokenRefresh] Shutting down...');
  server.close(() => process.exit(0));
});
