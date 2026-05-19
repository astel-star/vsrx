#!/usr/bin/env node
/**
 * Vidstorm Stremio Addon
 * Auto-generates tokens and provides streams
 */

const { addonBuilder } = require('stremio-addon-sdk');
const express = require('express');
const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const CryptoJS = require('crypto-js');
const cors = require('cors');
const { CookieJar } = require('tough-cookie');

// Wrap axios with cookie jar support (like Python requests.Session)
const cookieJar = new CookieJar();
const axiosInstance = wrapper(axios).create({
  timeout: 60000,
  maxRedirects: 10,
  jar: cookieJar,
  withCredentials: true
});

// TMDB API Key
const TMDB_API_KEY = '54e00466a09676df57ba51c4ca30b1a6';

// AES Key from JavaScript (must match exactly)
const AES_KEY = 'x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9';

// Server port
const PORT = process.env.PORT || 7000;

// Base URL for proxy (use env var for cloud deployment, fallback to localhost)
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

/**
 * Generate vidstorm token using AES-256-CBC
 */
function generateToken(tmdbId, mediaType = 'movie', season = null, episode = null) {
  let plaintext;
  if (mediaType === 'tv' && season !== null && episode !== null) {
    plaintext = `tv/${tmdbId}_${season}_${episode}`;
  } else {
    plaintext = String(tmdbId);
  }
  
  // Parse key and IV
  const key = CryptoJS.enc.Utf8.parse(AES_KEY);
  const iv = CryptoJS.enc.Utf8.parse(AES_KEY.substring(0, 16));
  
  // Encrypt
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv: iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7
  });
  
  // Get ciphertext and convert to base64url
  const ciphertext = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
  const token = ciphertext.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  console.log(`[Token] Generated ${token} for ${plaintext}`);
  return token;
}

/**
 * Fetch TMDB metadata
 */
async function getTmdbMetadata(tmdbId, type = 'movie') {
  try {
    const endpoint = type === 'tv' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/${endpoint}/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
  } catch (e) {
    console.error('TMDB error:', e.message);
    return null;
  }
}

/**
 * Search TMDB for movies/shows
 */
async function searchTmdb(query, type = 'movie') {
  try {
    const url = `https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=1`;
    const response = await axios.get(url, { timeout: 10000 });
    return response.data.results || [];
  } catch (e) {
    console.error('Search error:', e.message);
    return [];
  }
}

/**
 * Convert IMDB ID to TMDB ID
 */
async function imdbToTmdb(imdbId, type = 'movie') {
  try {
    const endpoint = type === 'tv' ? 'tv' : 'movie';
    const url = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const response = await axios.get(url, { timeout: 10000 });
    
    const results = type === 'tv' 
      ? response.data.tv_results 
      : response.data.movie_results;
    
    if (results && results.length > 0) {
      console.log(`[IMDB->TMDB] ${imdbId} -> ${results[0].id}`);
      return results[0].id;
    }
  } catch (e) {
    console.error('IMDB lookup error:', e.message);
  }
  return null;
}

/**
 * Fetch streams from vidstorm
 */
async function fetchStreams(tmdbId, type = 'movie', season = null, episode = null) {
  const token = generateToken(tmdbId, type, season, episode);
  const endpoint = type === 'tv' ? 'tv' : 'movie';
  const apiUrl = `https://vidstorm.ru/api/${endpoint}/${token}`;
  
  console.log(`[Streams] Fetching from ${apiUrl}`);
  
  try {
    const response = await axiosInstance.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': `https://vidstorm.ru/${endpoint}/${tmdbId}`,
        'Origin': 'https://vidstorm.ru'
      }
    });
    
    if (response.status === 200) {
      const data = response.data;
      const streams = [];
      const boronStreams = [];
      const otherStreams = [];
      
      for (const [name, source] of Object.entries(data)) {
        if (source && source.url) {
          const isBoron = source.url.includes('hydrostorm.workers.dev');
          const isLithium = source.url.includes('storrrrrrm.site');
          const isHydrogen = source.url.includes('vdrk.site');
          
          let streamUrl, behaviorHints;
          
          if (isBoron) {
            // Boron works directly with Stremio's streaming server
            streamUrl = source.url;
            behaviorHints = {
              proxyHeaders: {
                request: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                  'Referer': 'https://vidstorm.ru/',
                  'Origin': 'https://vidstorm.ru'
                }
              },
              notWebReady: false,
              bingeGroup: `vidstorm-${name.toLowerCase()}`
            };
          } else {
            // Lithium/Hydrogen need our custom proxy
            streamUrl = `${BASE_URL}/proxy?url=${encodeURIComponent(source.url)}&movie_id=${tmdbId}`;
            behaviorHints = {
              notWebReady: false,
              bingeGroup: `vidstorm-${name.toLowerCase()}`
            };
          }
          
          const streamObj = {
            name: `Vidstorm ${name}`,
            title: `${name} ${source.language || ''}`.trim(),
            url: streamUrl,
            type: source.type === 'mp4' ? 'video/mp4' : 'application/x-mpegURL',
            behaviorHints: behaviorHints
          };
          
          // Separate streams
          if (isBoron) {
            streamObj.title += ' ✅ (Boron)';
            boronStreams.push(streamObj);
          } else if (isLithium) {
            streamObj.title += ' 🔄 (Lithium - Proxied)';
            otherStreams.push(streamObj);
          } else if (isHydrogen) {
            streamObj.title += ' 🔄 (Hydrogen - Proxied)';
            otherStreams.push(streamObj);
          } else {
            streamObj.title += ' 🔄 (Other)';
            otherStreams.push(streamObj);
          }
        }
      }
      
      // Return Boron first (most reliable), then others as fallback
      const allStreams = [...boronStreams, ...otherStreams];
      console.log(`[Streams] Found ${boronStreams.length} Boron + ${otherStreams.length} other sources`);
      return allStreams;
    }
  } catch (e) {
    console.error('Stream fetch error:', e.message);
  }
  
  return [];
}

/**
 * Fetch subtitles
 */
async function fetchSubtitles(tmdbId) {
  try {
    const url = `https://sub.vdrk.site/v2/movie/${tmdbId}`;
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.status === 200 && Array.isArray(response.data)) {
      return response.data.map(sub => ({
        id: sub.label.toLowerCase().replace(/\s+/g, '_'),
        lang: sub.label.toLowerCase().substring(0, 2),
        url: sub.file
      }));
    }
  } catch (e) {
    // Subtitles are optional
  }
  return [];
}

/**
 * Build Stremio manifest
 */
const manifest = {
  id: 'org.vidstorm.addon',
  version: '1.0.0',
  name: 'Vidstorm',
  description: 'Stream movies and TV shows from Vidstorm with auto token generation',
  logo: 'https://vidstorm.ru/favicon.ico',
  resources: ['catalog', 'meta', 'stream', 'subtitles'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tmdb:'],
  catalogs: [
    {
      type: 'movie',
      id: 'vidstorm-popular',
      name: 'Popular Movies',
      extra: [{ name: 'search', isRequired: false }]
    },
    {
      type: 'series',
      id: 'vidstorm-tv',
      name: 'TV Shows',
      extra: [{ name: 'search', isRequired: false }]
    }
  ],
  behaviorHints: {
    configurable: false,
    configurationRequired: false,
    proxyURL: true  // Enable proxying to bypass CORS
  }
};

/**
 * Start server with Express and proxy support
 */
const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Proxy route for streams - bypasses CORS
app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  const movieId = req.query.movie_id;
  
  // Set CORS headers immediately
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Range, Authorization');
  res.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  
  if (!url) {
    return res.status(400).json({ error: 'No URL provided' });
  }
  
  console.log(`[Proxy] ${url.substring(0, 80)}... (movie_id: ${movieId || 'none'})`);
  
  try {
    // Determine if HLS based on URL
    const isHls = url.includes('.m3u8') || url.includes('playlist');
    
    // Build proper headers with movie-specific referer
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': isHls ? '*/*' : 'video/*, application/octet-stream, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Origin': 'https://vidstorm.ru',
      'Connection': 'keep-alive'
    };
    
    if (movieId) {
      headers['Referer'] = `https://vidstorm.ru/movie/${movieId}`;
    } else {
      headers['Referer'] = 'https://vidstorm.ru/';
    }
    
    const response = await axiosInstance({
      method: 'get',
      url: url,
      headers: headers,
      responseType: isHls ? 'text' : 'stream',
      timeout: isHls ? 10000 : 60000,
      validateStatus: (status) => status < 500 // Don't throw on 4xx errors
    });
    
    if (response.status >= 400) {
      console.error(`[Proxy] Upstream error ${response.status} for ${url.substring(0, 80)}`);
      return res.status(response.status).send(`Upstream error: ${response.status}`);
    }
    
    if (isHls) {
      // Rewrite HLS playlist to proxy all URLs
      let playlist = typeof response.data === 'string' ? response.data : response.data.toString('utf-8');
      const baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
      const movieParam = movieId ? `&movie_id=${movieId}` : '';
      
      // Log if TikTok CDN is detected
      if (playlist.includes('tiktokcdn.com')) {
        console.log(`[Proxy] HLS contains TikTok CDN segments`);
      }
      
      // Rewrite absolute URLs
      playlist = playlist.replace(/^(https?:\/\/[^\s]+)$/gm, (match) => {
        if (match.includes('/proxy?url=') || match.startsWith('data:')) {
          return match;
        }
        return `${BASE_URL}/proxy?url=${encodeURIComponent(match)}${movieParam}`;
      });
      
      // Rewrite relative paths
      playlist = playlist.replace(/^([^#\s][^\s]*)$/gm, (match) => {
        if (match.startsWith('http')) return match;
        try {
          const absoluteUrl = new URL(match, baseUrl).href;
          return `${BASE_URL}/proxy?url=${encodeURIComponent(absoluteUrl)}${movieParam}`;
        } catch (e) {
          return match;
        }
      });
      
      res.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      res.set('Cache-Control', 'no-cache');
      res.send(playlist);
      console.log(`[Proxy] Rewrote HLS playlist (${playlist.length} bytes)`);
    } else {
      // Stream video segments directly
      let contentType = response.headers['content-type'] || 'video/mp4';
      
      // Fix for TS segments
      if (url.includes('.ts') || contentType.includes('mp2t') || contentType.includes('mpeg2')) {
        contentType = 'video/mp2t';
      }
      
      res.set('Content-Type', contentType);
      res.set('Accept-Ranges', 'bytes');
      
      // Forward content length if present
      if (response.headers['content-length']) {
        res.set('Content-Length', response.headers['content-length']);
      }
      
      // Forward cache headers if present
      if (response.headers['cache-control']) {
        res.set('Cache-Control', response.headers['cache-control']);
      }
      if (response.headers['etag']) {
        res.set('ETag', response.headers['etag']);
      }
      
      // Handle streaming errors
      response.data.on('error', (err) => {
        console.error(`[Proxy] Stream error: ${err.message}`);
        if (!res.headersSent) {
          res.status(500).end();
        }
      });
      
      response.data.pipe(res);
      console.log(`[Proxy] Streaming video segment (${contentType})`);
    }
  } catch (error) {
    console.error('[Proxy] Error:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Stremio manifest endpoint
app.get('/manifest.json', (req, res) => {
  res.json(manifest);
});

// Catalog endpoint - manually call the catalog handler
app.get('/catalog/:type/:id/:extra?.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    const extra = req.query;
    
    console.log(`[Catalog] ${type}/${id}`, extra);
    
    const metas = [];
    
    if (extra && extra.search) {
      // Search TMDB
      const results = await searchTmdb(extra.search, type === 'series' ? 'tv' : 'movie');
      
      for (const item of results.slice(0, 20)) {
        metas.push({
          id: `tmdb:${item.id}`,
          type: type,
          name: item.title || item.name,
          poster: item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null,
          description: item.overview,
          releaseInfo: (item.release_date || item.first_air_date || '').substring(0, 4)
        });
      }
    } else {
      // Return popular movies/shows
      const popularIds = type === 'movie' 
        ? [557, 550, 672, 155, 238, 13, 27205, 603, 122, 120]
        : [1399, 71446, 66732, 82856, 93405, 60625, 19885];
      
      for (const tmdbId of popularIds) {
        const meta = await getTmdbMetadata(tmdbId, type === 'series' ? 'tv' : 'movie');
        if (meta) {
          metas.push({
            id: `tmdb:${meta.id}`,
            type: type,
            name: meta.title || meta.name,
            poster: meta.poster_path ? `https://image.tmdb.org/t/p/w300${meta.poster_path}` : null,
            description: meta.overview,
            releaseInfo: (meta.release_date || meta.first_air_date || '').substring(0, 4)
          });
        }
      }
    }
    
    res.json({ metas });
  } catch (e) {
    console.error('Catalog error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Meta endpoint
app.get('/meta/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`[Meta] ${type}/${id}`);
    
    let tmdbId;
    if (id.startsWith('tmdb:')) {
      tmdbId = id.split(':')[1];
    } else if (id.startsWith('tt')) {
      return res.json({ meta: null });
    } else {
      tmdbId = id;
    }
    
    const meta = await getTmdbMetadata(tmdbId, type === 'series' ? 'tv' : 'movie');
    
    if (!meta) {
      return res.json({ meta: null });
    }
    
    res.json({
      meta: {
        id: id,
        type: type,
        name: meta.title || meta.name,
        poster: meta.poster_path ? `https://image.tmdb.org/t/p/w500${meta.poster_path}` : null,
        background: meta.backdrop_path ? `https://image.tmdb.org/t/p/original${meta.backdrop_path}` : null,
        description: meta.overview,
        releaseInfo: meta.release_date || meta.first_air_date,
        runtime: meta.runtime ? `${meta.runtime} min` : null,
        language: meta.original_language,
        imdbId: meta.imdb_id
      }
    });
  } catch (e) {
    console.error('Meta error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Stream endpoint
app.get('/stream/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`[Stream] ${type}/${id}`);
    
    let tmdbId, season, episode;
    
    let cleanId = id;
    if (id.startsWith('tmdb:')) {
      cleanId = id.split(':')[1];
    }
    
    // Check if it's an IMDB ID and convert to TMDB
    if (cleanId.startsWith('tt')) {
      const convertedId = await imdbToTmdb(cleanId, type);
      if (!convertedId) {
        return res.json({ streams: [] });
      }
      cleanId = String(convertedId);
    }
    
    const parts = cleanId.split(':');
    tmdbId = parts[0];
    season = parts[1] ? parseInt(parts[1]) : null;
    episode = parts[2] ? parseInt(parts[2]) : null;
    
    const streams = await fetchStreams(tmdbId, type, season, episode);
    
    res.json({ streams });
  } catch (e) {
    console.error('Stream error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Subtitles endpoint
app.get('/subtitles/:type/:id.json', async (req, res) => {
  try {
    const { type, id } = req.params;
    console.log(`[Subtitles] ${type}/${id}`);
    
    let cleanId = id;
    if (id.startsWith('tmdb:')) {
      cleanId = id.split(':')[1];
    }
    const tmdbId = cleanId.split(':')[0];
    
    const subtitles = await fetchSubtitles(tmdbId);
    
    res.json({ subtitles });
  } catch (e) {
    console.error('Subtitles error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Vidstorm Stremio Addon running on http://localhost:${PORT}`);
  console.log('');
  console.log('Manifest: http://localhost:' + PORT + '/manifest.json');
  console.log('');
  console.log('Install in Stremio:');
  console.log('  1. Open Stremio');
  console.log('  2. Go to Addons');
  console.log('  3. Click "Add addon"');
  console.log('  4. Enter: http://localhost:' + PORT + '/manifest.json');
  console.log('');
});
