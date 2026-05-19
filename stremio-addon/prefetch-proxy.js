/**
 * Pre-fetching Proxy for Stremio
 * Aggressively pre-fetches segments to reduce time-to-first-frame
 */

const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');

const PROXY_PORT = 7001;

// Cache for pre-fetched segments
const segmentCache = new Map();
const CACHE_TTL = 30000; // 30 seconds

// Track timing
const playlistServeTimes = new Map(); // URL -> timestamp when playlist was served

// Token refresh tracking
const movieIdCache = new Map(); // segment URL -> movie_id mapping
const refreshAttempts = new Map(); // URL -> attempt count
const MAX_REFRESH_ATTEMPTS = 2;

// Parse HLS playlist to extract segment URLs
function parsePlaylist(playlistContent, baseUrl) {
  const lines = playlistContent.split('\n');
  const segments = [];
  
  console.log(`[PreFetch] Parsing ${lines.length} lines...`);
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Match any non-comment line that's a URL
    if (trimmed && !trimmed.startsWith('#')) {
      // Check if it looks like a segment URL
      const isSegment = trimmed.startsWith('http') || 
                       trimmed.includes('tiktok') ||
                       trimmed.includes('.m4s') || 
                       trimmed.includes('.ts') ||
                       trimmed.includes('.mp4');
      
      if (isSegment) {
        // Make absolute URL
        let absoluteUrl = trimmed;
        if (!trimmed.startsWith('http')) {
          absoluteUrl = new URL(trimmed, baseUrl).href;
        }
        segments.push(absoluteUrl);
        console.log(`[PreFetch] Found segment: ${absoluteUrl.substring(0, 80)}...`);
      }
    }
  }
  
  console.log(`[PreFetch] Total segments found: ${segments.length}`);
  return segments;
}

// AES Token Generation (matches addon.js exactly)
const AES_KEY = 'x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9';

function generateToken(tmdbId, type = 'movie', season = null, episode = null) {
  let plaintext;
  if (type === 'tv' && season !== null && episode !== null) {
    plaintext = `tv/${tmdbId}_${season}_${episode}`;
  } else {
    plaintext = String(tmdbId);
  }
  
  // Use static IV (first 16 chars of key) - matches addon.js
  const key = Buffer.from(AES_KEY, 'utf8');
  const iv = Buffer.from(AES_KEY.substring(0, 16), 'utf8');
  
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  return encrypted;
}

// Fetch fresh playlist from VidStorm API
async function fetchFreshPlaylist(tmdbId, type = 'movie') {
  const token = generateToken(tmdbId, type);
  const apiUrl = `https://vidstorm.ru/api/movie/${token}`;
  
  console.log(`[TokenRefresh] Fetching fresh playlist for movie ${tmdbId}...`);
  
  return new Promise((resolve, reject) => {
    const req = https.request(apiUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': `https://vidstorm.ru/movie/${tmdbId}`,
        'Origin': 'https://vidstorm.ru',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      },
      timeout: 15000
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`[TokenRefresh] API response: ${json.status || 'unknown'}`);
          
          if (json.status === 'success' && json.data && json.data.sources) {
            // Find Lithium source
            const lithium = json.data.sources.find(s => s.name === 'Lithium' || s.name.includes('Lithium'));
            if (lithium && lithium.url) {
              console.log(`[TokenRefresh] Got fresh Lithium URL: ${lithium.url.substring(0, 60)}...`);
              resolve(lithium.url);
            } else {
              reject(new Error('No Lithium source found'));
            }
          } else {
            reject(new Error(`API error: ${json.message || json.status}`));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}`));
        }
      });
    });
    
    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

// Get fresh segment URL by refreshing token
async function getFreshSegmentUrl(originalUrl, movieId) {
  console.log(`[TokenRefresh] Getting fresh URL for expired segment...`);
  
  try {
    // Fetch fresh master playlist
    const freshMasterUrl = await fetchFreshPlaylist(movieId);
    
    // Fetch the quality playlist (replace master.m3u8 with quality)
    const qualityUrl = originalUrl.replace(/master\.m3u8/, '536p.m3u8'); // Assume 536p
    
    // Actually, we need to parse the fresh playlist to get the segment
    // For now, return the fresh master URL and let the player re-request
    return freshMasterUrl;
  } catch (err) {
    console.error(`[TokenRefresh] Failed: ${err.message}`);
    throw err;
  }
}

// Fetch segment and cache it
async function prefetchSegment(segmentUrl, headers) {
  const cacheKey = segmentUrl;
  
  // Check if already cached
  if (segmentCache.has(cacheKey)) {
    const cached = segmentCache.get(cacheKey);
    if (Date.now() - cached.time < CACHE_TTL) {
      console.log(`[PreFetch] Using cached: ${segmentUrl.substring(0, 80)}...`);
      return cached.data;
    }
  }
  
  console.log(`[PreFetch] Fetching: ${segmentUrl.substring(0, 80)}...`);
  
  return new Promise((resolve, reject) => {
    const parsed = new URL(segmentUrl);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: headers,
      timeout: 15000
    };
    
    const chunks = [];
    const req = client.request(options, (res) => {
      console.log(`[PreFetch] Response: ${res.statusCode} for ${segmentUrl.substring(0, 60)}...`);
      
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        
        // Cache the segment
        segmentCache.set(cacheKey, {
          data: buffer,
          time: Date.now(),
          contentType: res.headers['content-type'] || 'video/mp4',
          contentLength: buffer.length
        });
        
        console.log(`[PreFetch] Cached ${buffer.length} bytes`);
        resolve(buffer);
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    req.end();
  });
}

// Pre-fetch first N segments from a playlist
async function prefetchFromPlaylist(playlistUrl, headers, count = 5) {
  console.log(`\n[PreFetch] Parsing playlist: ${playlistUrl.substring(0, 80)}...`);
  
  try {
    // Fetch playlist
    const parsed = new URL(playlistUrl);
    const isHttps = parsed.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const playlistData = await new Promise((resolve, reject) => {
      const req = client.request({
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: headers,
        timeout: 10000
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.end();
    });
    
    // Parse segments
    const segments = parsePlaylist(playlistData, playlistUrl);
    console.log(`[PreFetch] Found ${segments.length} segments, pre-fetching first ${count}...`);
    
    // Pre-fetch first N segments in parallel
    const toFetch = segments.slice(0, count);
    const promises = toFetch.map(url => prefetchSegment(url, headers).catch(err => {
      console.log(`[PreFetch] Failed: ${err.message}`);
      return null;
    }));
    
    await Promise.all(promises);
    console.log(`[PreFetch] Pre-fetch complete for ${playlistUrl.substring(0, 60)}...\n`);
    
  } catch (err) {
    console.error(`[PreFetch] Error: ${err.message}`);
  }
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
  
  console.log(`\n[Proxy] ${targetUrl.substring(0, 100)}...`);
  
  // Check if this is a segment request (not a playlist)
  const isSegmentRequest = targetUrl.includes('tiktokcdn') || targetUrl.includes('.m4s') || targetUrl.includes('.ts');
  if (isSegmentRequest) {
    // Find the matching playlist serve time
    let playlistUrl = null;
    let serveTime = null;
    for (const [url, time] of playlistServeTimes.entries()) {
      if (targetUrl.includes(new URL(url).hostname) || 
          (targetUrl.includes('tiktok') && url.includes('tiktok'))) {
        playlistUrl = url;
        serveTime = time;
        break;
      }
    }
    
    if (serveTime) {
      const delay = Date.now() - serveTime;
      console.log(`[⏱️ TIMING] Segment requested ${delay}ms after playlist was served`);
      if (delay > 5000) {
        console.log(`[⏱️ TIMING] ⚠️ WARNING: Delay > 5 seconds! URLs may have expired.`);
      }
    } else {
      console.log(`[⏱️ TIMING] No matching playlist found for timing comparison`);
    }
  }
  
  // Check cache first for segments
  const cacheKey = targetUrl;
  if (segmentCache.has(cacheKey)) {
    const cached = segmentCache.get(cacheKey);
    if (Date.now() - cached.time < CACHE_TTL) {
      console.log(`[Proxy] ✅ CACHE HIT - Serving cached segment`);
      res.writeHead(200, {
        'Content-Type': cached.contentType,
        'Content-Length': cached.contentLength,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(cached.data);
      return;
    }
  }
  
  try {
    const targetParsed = new URL(targetUrl);
    const isHttps = targetParsed.protocol === 'https:';
    const client = isHttps ? https : http;
    
    // Build headers
    const headers = {
      'User-Agent': req.headers['user-agent'] || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': req.headers.accept || '*/*',
      'Referer': movieId ? `https://vidstorm.ru/movie/${movieId}` : 'https://vidstorm.ru/',
      'Origin': 'https://vidstorm.ru'
    };
    
    // Check if this is an HLS playlist
    const isPlaylist = targetUrl.includes('.m3u8') || targetUrl.includes('master');
    
    const options = {
      hostname: targetParsed.hostname,
      port: targetParsed.port || (isHttps ? 443 : 80),
      path: targetParsed.pathname + targetParsed.search,
      method: 'GET',
      headers: headers,
      timeout: 30000
    };
    
    const proxyReq = client.request(options, async (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      const isHls = contentType.includes('mpegurl') || contentType.includes('m3u8') || targetUrl.includes('.m3u8');
      
      console.log(`[Proxy] Response: ${proxyRes.statusCode}, Type: ${contentType}`);
      
      if (isHls) {
        // Buffer the playlist
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          // Rewrite URLs to go through this proxy
          const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
          const movieParam = movieId ? `&movie_id=${movieId}` : '';
          
          // Rewrite all URLs in playlist
          data = data.replace(/^(https?:\/\/[^\s]+)$/gm, (match) => {
            if (match.includes('127.0.0.1:7001')) return match;
            return `http://127.0.0.1:7001/proxy?url=${encodeURIComponent(match)}${movieParam}`;
          });
          
          // Also rewrite relative URLs
          data = data.replace(/^([^#\s][^\s]*)$/gm, (match) => {
            if (match.startsWith('http') || match.startsWith('//') || match.includes('127.0.0.1')) return match;
            const absoluteUrl = new URL(match, baseUrl).href;
            return `http://127.0.0.1:7001/proxy?url=${encodeURIComponent(absoluteUrl)}${movieParam}`;
          });
          
          console.log(`[Proxy] Rewrote HLS playlist (${data.length} bytes)`);
          
          res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Content-Length': Buffer.byteLength(data),
            'Access-Control-Allow-Origin': '*'
          });
          res.end(data);
          
          // Record when we served this playlist
          const serveTime = Date.now();
          playlistServeTimes.set(targetUrl, serveTime);
          console.log(`\n[⏱️ TIMING] Playlist served at ${new Date().toISOString()}`);
          console.log(`[⏱️ TIMING] URL: ${targetUrl.substring(0, 60)}...`);
          
          // 🚀 TRIGGER PRE-FETCH after sending playlist
          // This happens in background, doesn't block the response
          if (isPlaylist) {
            console.log(`[Proxy] 🚀 Triggering pre-fetch for playlist...`);
            prefetchFromPlaylist(targetUrl, headers, 5).catch(err => {
              console.error(`[PreFetch] Background error: ${err.message}`);
            });
          }
        });
        return;
      }
      
      // For video segments, proxy directly
      const responseHeaders = {
        'Content-Type': proxyRes.headers['content-type'] || 'video/mp4',
        'Access-Control-Allow-Origin': '*'
      };
      
      // Only add headers that exist
      if (proxyRes.headers['content-length']) {
        responseHeaders['Content-Length'] = proxyRes.headers['content-length'];
      }
      if (proxyRes.headers['accept-ranges']) {
        responseHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
      }
      if (proxyRes.headers['content-range']) {
        responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }
      
      // Check if we got an error (PNG instead of video, or non-200 status)
      const segmentContentType = proxyRes.headers['content-type'] || '';
      const isError = proxyRes.statusCode !== 200 && proxyRes.statusCode !== 206;
      const isPng = segmentContentType.includes('image/png');
      
      if (isError || isPng) {
        console.log(`[Proxy] ⚠️ Segment failed! Status: ${proxyRes.statusCode}, Type: ${segmentContentType}`);
        
        // Check if we should try token refresh
        const attemptCount = refreshAttempts.get(targetUrl) || 0;
        if (attemptCount < MAX_REFRESH_ATTEMPTS && movieId) {
          console.log(`[Proxy] 🔄 Attempting token refresh (attempt ${attemptCount + 1}/${MAX_REFRESH_ATTEMPTS})...`);
          refreshAttempts.set(targetUrl, attemptCount + 1);
          
          // Store movie ID for this segment
          movieIdCache.set(targetUrl, movieId);
          
          // Try to get fresh URL and retry
          try {
            const freshUrl = await getFreshSegmentUrl(targetUrl, movieId);
            console.log(`[Proxy] 🔄 Got fresh URL, retrying...`);
            
            // Retry with fresh URL (recursive call to proxy)
            req.url = `/proxy?url=${encodeURIComponent(freshUrl)}&movie_id=${movieId}`;
            // Reset attempt count for fresh URL
            refreshAttempts.delete(targetUrl);
            
            // Re-process this request
            server.emit('request', req, res);
            return;
          } catch (refreshErr) {
            console.error(`[Proxy] Token refresh failed: ${refreshErr.message}`);
          }
        }
      }
      
      // Reset refresh attempts on success
      if (!isError && !isPng) {
        refreshAttempts.delete(targetUrl);
      }
      
      res.writeHead(proxyRes.statusCode, responseHeaders);
      proxyRes.pipe(res);
    });
    
    proxyReq.on('error', (err) => {
      console.error(`[Proxy] Error: ${err.message}`);
      res.writeHead(500);
      res.end(`Proxy error: ${err.message}`);
    });
    
    proxyReq.end();
    
  } catch (err) {
    console.error(`[Proxy] Error: ${err.message}`);
    res.writeHead(500);
    res.end(`Error: ${err.message}`);
  }
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[PreFetch Proxy] Running on http://127.0.0.1:${PROXY_PORT}`);
  console.log(`[PreFetch Proxy] Features:`);
  console.log(`  - Detects HLS playlist requests`);
  console.log(`  - Pre-fetches first 5 segments in background`);
  console.log(`  - Serves cached segments instantly`);
  console.log(`  - Reduces time-to-first-frame for Stremio\n`);
});

// Cleanup old cache entries every minute
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of segmentCache.entries()) {
    if (now - value.time > CACHE_TTL) {
      segmentCache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`[Cache] Cleaned ${cleaned} expired entries`);
  }
}, 60000);

process.on('SIGINT', () => {
  console.log('\n[PreFetch Proxy] Shutting down...');
  server.close(() => process.exit(0));
});
