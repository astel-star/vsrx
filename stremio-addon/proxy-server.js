/**
 * Local Video Proxy Server
 * Runs on user's machine to forward segment requests to TikTok CDN
 * Same IP = signatures valid, we just fix the headers
 */

const http = require('http');
const https = require('https');
const url = require('url');
const { CookieJar } = require('tough-cookie');

const PROXY_PORT = 7001;
const cookieJar = new CookieJar();

// Store cookies from vidstorm.ru visits
let vidstormCookies = '';

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const targetUrl = parsedUrl.query.url;
  const movieId = parsedUrl.query.movie_id;
  
  if (!targetUrl) {
    res.writeHead(400);
    res.end('Missing url parameter');
    return;
  }
  
  console.log(`[VideoProxy] ${targetUrl.substring(0, 80)}...`);
  
  try {
    const targetParsed = new URL(targetUrl);
    const isHttps = targetParsed.protocol === 'https:';
    const client = isHttps ? https : http;
    
    // Build headers that match browser exactly
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'identity', // Don't request compression we can't handle
      'Referer': movieId ? `https://vidstorm.ru/movie/${movieId}` : 'https://vidstorm.ru/',
      'Origin': 'https://vidstorm.ru',
      'Connection': 'keep-alive',
      'Sec-Fetch-Dest': 'video',
      'Sec-Fetch-Mode': 'no-cors',
      'Sec-Fetch-Site': 'cross-site',
      ...req.headers // Forward range requests, etc.
    };
    
    // Remove problematic headers
    delete headers.host;
    delete headers['accept-encoding']; // Let the CDN decide
    
    const options = {
      hostname: targetParsed.hostname,
      port: targetParsed.port || (isHttps ? 443 : 80),
      path: targetParsed.pathname + targetParsed.search,
      method: 'GET',
      headers: headers,
      timeout: 60000 // 60 second timeout for slow CDN
    };
    
    let headersSent = false;
    
    const proxyReq = client.request(options, (proxyRes) => {
      // Log response info
      const contentLength = proxyRes.headers['content-length'];
      const contentType = proxyRes.headers['content-type'] || '';
      
      console.log(`[VideoProxy] Response: ${proxyRes.statusCode}, Type: ${contentType}, Size: ${contentLength || 'unknown'}`);
      
      // Check if this is an HLS playlist that needs rewriting
      const isHls = contentType.includes('mpegurl') || contentType.includes('m3u8') || targetUrl.includes('.m3u8');
      
      if (isHls) {
        // Buffer the entire playlist for rewriting
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
          // Rewrite all URLs in the playlist to go through this proxy
          const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
          const movieParam = movieId ? `&movie_id=${movieId}` : '';
          
          // Rewrite absolute URLs
          data = data.replace(/^(https?:\/\/[^\s]+)$/gm, (match) => {
            if (match.includes('127.0.0.1:7001') || match.startsWith('data:')) return match;
            return `http://127.0.0.1:7001/proxy?url=${encodeURIComponent(match)}${movieParam}`;
          });
          
          // Rewrite relative paths
          data = data.replace(/^([^#\s][^\s]*)$/gm, (match) => {
            if (match.startsWith('http') || match.startsWith('//')) return match;
            const absoluteUrl = new URL(match, baseUrl).href;
            return `http://127.0.0.1:7001/proxy?url=${encodeURIComponent(absoluteUrl)}${movieParam}`;
          });
          
          console.log(`[VideoProxy] Rewrote HLS playlist (${data.length} bytes)`);
          
          headersSent = true;
          res.writeHead(200, {
            'Content-Type': 'application/vnd.apple.mpegurl',
            'Content-Length': Buffer.byteLength(data),
            'Access-Control-Allow-Origin': '*'
          });
          res.end(data);
        });
        return;
      }
      
      // Check if we got an error response (small size for video)
      if (contentLength && parseInt(contentLength) < 100000 && 
          (targetUrl.includes('.ts') || targetUrl.includes('.m4s') || targetUrl.includes('tiktokcdn'))) {
        console.log(`[VideoProxy] ⚠️ Small video segment (${contentLength} bytes) from TikTok CDN`);
      }
      
      // Force correct content-type for video segments (TikTok CDN lies about image/png)
      let finalContentType = contentType;
      if (targetUrl.includes('.ts')) {
        finalContentType = 'video/mp2t';
      } else if (targetUrl.includes('.m4s') || targetUrl.includes('.mp4')) {
        finalContentType = 'video/mp4';
      } else if (targetUrl.includes('tiktokcdn')) {
        // TikTok fMP4 segments
        finalContentType = 'video/mp4';
      }
      
      // Build response headers (only include defined values)
      const responseHeaders = {
        'Content-Type': finalContentType || 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*'
      };
      
      if (contentLength) {
        responseHeaders['Content-Length'] = contentLength;
      }
      if (proxyRes.headers['accept-ranges']) {
        responseHeaders['Accept-Ranges'] = proxyRes.headers['accept-ranges'];
      }
      if (proxyRes.headers['content-range']) {
        responseHeaders['Content-Range'] = proxyRes.headers['content-range'];
      }
      
      headersSent = true;
      console.log(`[VideoProxy] Sending to client: ${finalContentType}, ${contentLength || 'unknown'} bytes, status ${proxyRes.statusCode}`);
      res.writeHead(proxyRes.statusCode, responseHeaders);
      
      // For small segments, check if it's actually an error
      if (contentLength && parseInt(contentLength) < 100000 && targetUrl.includes('tiktokcdn')) {
        // Buffer to check for PNG signature or error HTML
        const chunks = [];
        proxyRes.on('data', chunk => chunks.push(chunk));
        proxyRes.on('end', () => {
          const buffer = Buffer.concat(chunks);
          // Check for PNG signature (error image from TikTok)
          if (buffer.slice(0, 8).toString('hex') === '89504e470d0a1a0a') {
            console.log(`[VideoProxy] ⚠️ Received PNG error image instead of video!`);
          } else if (buffer.toString('utf-8', 0, 100).includes('<!DOCTYPE')) {
            console.log(`[VideoProxy] ⚠️ Received HTML error page instead of video!`);
          } else {
            console.log(`[VideoProxy] ✓ Valid video segment (${buffer.length} bytes)`);
          }
          res.end(buffer);
        });
      } else {
        // Pipe large segments directly
        proxyRes.pipe(res);
      }
    });
    
    proxyReq.on('error', (err) => {
      console.error(`[VideoProxy] Error: ${err.message}`);
      if (!headersSent) {
        res.writeHead(500);
        res.end(`Proxy error: ${err.message}`);
      }
    });
    
    proxyReq.on('timeout', () => {
      proxyReq.destroy();
      if (!headersSent) {
        res.writeHead(504);
        res.end('Gateway timeout');
      }
    });
    
    proxyReq.end();
    
  } catch (err) {
    console.error(`[VideoProxy] Error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end(`Error: ${err.message}`);
    }
  }
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  console.log(`[VideoProxy] Server running on http://127.0.0.1:${PROXY_PORT}`);
  console.log(`[VideoProxy] Use: http://127.0.0.1:${PROXY_PORT}/proxy?url=<encoded_url>&movie_id=<id>`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[VideoProxy] Shutting down...');
  server.close(() => {
    process.exit(0);
  });
});

// Catch unhandled errors to keep server running
process.on('uncaughtException', (err) => {
  console.error('[VideoProxy] Uncaught exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('[VideoProxy] Unhandled rejection:', err);
});
