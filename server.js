#!/usr/bin/env node
/**
 * Vidstorm Resolver Server - Pure JavaScript Implementation
 * Express server providing API endpoints for stream resolution
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 8080;

// TMDB API Key
const TMDB_API_KEY = "54e00466a09676df57ba51c4ca30b1a6";

// Middleware
app.use(cors());
app.use(express.json());

/**
 * Fetch TMDB metadata
 */
async function getTmdbMetadata(tmdbId) {
  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
  } catch (error) {
    console.error('TMDB fetch error:', error.message);
    return null;
  }
}

/**
 * Extract token using headless browser
 * This is the ONLY reliable method
 */
async function extractTokenWithBrowser(tmdbId) {
  try {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });
    const page = await context.newPage();
    
    let capturedToken = null;
    
    // Intercept network requests
    await page.route('**/*', (route, request) => {
      const url = request.url();
      const match = url.match(/\/api\/(?:movie|tv)\/([A-Za-z0-9_-]{20,40})/);
      if (match && !capturedToken) {
        capturedToken = match[1];
        console.log(`[Browser] Captured token: ${capturedToken}`);
      }
      route.continue();
    });
    
    // Load movie page
    const movieUrl = `https://vidstorm.ru/movie/${tmdbId}`;
    console.log(`[Browser] Loading ${movieUrl}...`);
    
    try {
      await page.goto(movieUrl, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
      // Timeout expected, continue
    }
    
    // Wait for API calls
    await page.waitForTimeout(5000);
    
    // Also try to extract from page content
    if (!capturedToken) {
      try {
        const content = await page.content();
        const match = content.match(/\/api\/movie\/([A-Za-z0-9_-]{20,40})/);
        if (match) {
          capturedToken = match[1];
          console.log(`[Browser] Extracted token from HTML: ${capturedToken}`);
        }
      } catch (e) {
        // Ignore
      }
    }
    
    await browser.close();
    return capturedToken;
    
  } catch (error) {
    console.error('[Browser] Error:', error.message);
    return null;
  }
}

/**
 * Fetch streams from vidstorm API
 */
async function fetchStreams(tmdbId, token) {
  const result = {
    movie_id: tmdbId,
    token: token,
    sources: [],
    subtitles: [],
    metadata: null
  };
  
  // Get TMDB metadata
  const metadata = await getTmdbMetadata(tmdbId);
  if (metadata) {
    result.metadata = {
      title: metadata.title,
      original_title: metadata.original_title,
      overview: metadata.overview,
      poster_path: metadata.poster_path ? `https://image.tmdb.org/t/p/w500${metadata.poster_path}` : null,
      backdrop_path: metadata.backdrop_path ? `https://image.tmdb.org/t/p/original${metadata.backdrop_path}` : null,
      release_date: metadata.release_date,
      runtime: metadata.runtime,
      vote_average: metadata.vote_average,
      imdb_id: metadata.imdb_id
    };
  }
  
  // Fetch streams
  if (token) {
    const apiUrl = `https://vidstorm.ru/api/movie/${token}`;
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': '*/*',
      'Referer': `https://vidstorm.ru/movie/${tmdbId}`,
      'Origin': 'https://vidstorm.ru'
    };
    
    try {
      console.log(`[API] Fetching streams from ${apiUrl}`);
      const response = await axios.get(apiUrl, { headers, timeout: 15000 });
      console.log(`[API] Status: ${response.status}`);
      
      if (response.status === 200) {
        const data = response.data;
        console.log(`[API] Got ${Object.keys(data).length} sources`);
        
        for (const [name, source] of Object.entries(data)) {
          if (source && source.url) {
            result.sources.push({
              name: name,
              url: source.url,
              type: source.type || 'hls',
              language: source.language,
              flag: source.flag
            });
          }
        }
      }
    } catch (error) {
      console.error('[API] Error:', error.message);
      result.error = error.message;
    }
  }
  
  // Fetch subtitles
  try {
    const subUrl = `https://sub.vdrk.site/v2/movie/${tmdbId}`;
    const response = await axios.get(subUrl, { timeout: 10000 });
    if (response.status === 200 && Array.isArray(response.data)) {
      result.subtitles = response.data;
    }
  } catch (error) {
    // Subtitles are optional
  }
  
  return result;
}

/**
 * Resolve movie streams
 * GET /api/movie/:tmdbId?token=xxx
 */
app.get('/api/movie/:tmdbId', async (req, res) => {
  const tmdbId = req.params.tmdbId;
  let token = req.query.token;
  
  console.log(`[Request] /api/movie/${tmdbId}${token ? '?token=xxx' : ''}`);
  
  // If no token, extract with browser
  if (!token) {
    console.log('[Request] No token provided, extracting with browser...');
    token = await extractTokenWithBrowser(tmdbId);
  }
  
  if (!token) {
    return res.status(500).json({
      error: 'Failed to extract token',
      message: 'Browser automation failed. Try providing a token manually.'
    });
  }
  
  const result = await fetchStreams(tmdbId, token);
  result.token_source = req.query.token ? 'provided' : 'browser';
  
  res.json(result);
});

/**
 * Resolve by IMDB ID
 * GET /api/imdb/:imdbId
 */
app.get('/api/imdb/:imdbId', async (req, res) => {
  const imdbId = req.params.imdbId;
  
  try {
    // Search TMDB for this IMDB ID
    const searchUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const response = await axios.get(searchUrl, { timeout: 10000 });
    
    if (response.data.movie_results && response.data.movie_results.length > 0) {
      const tmdbId = response.data.movie_results[0].id;
      
      // Extract token and fetch streams
      const token = await extractTokenWithBrowser(tmdbId);
      const result = await fetchStreams(tmdbId, token);
      result.imdb_id = imdbId;
      result.tmdb_id = tmdbId;
      
      res.json(result);
    } else {
      res.status(404).json({ error: 'Movie not found for IMDB ID', imdb_id: imdbId });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get fresh token
 * GET /api/token?movieId=xxx
 */
app.get('/api/token', async (req, res) => {
  const movieId = req.query.movieId || '557';
  
  const token = await extractTokenWithBrowser(movieId);
  
  if (token) {
    res.json({
      token: token,
      movie_id: movieId,
      usage: `/api/movie/${movieId}?token=${token}`,
      message: 'Token extracted using headless browser'
    });
  } else {
    res.status(500).json({ error: 'Failed to extract token' });
  }
});

/**
 * Health check
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vidstorm-resolver-js',
    endpoints: [
      'GET /api/movie/:tmdbId - Resolve by TMDB ID (auto-extracts token)',
      'GET /api/movie/:tmdbId?token=xxx - Resolve with explicit token',
      'GET /api/imdb/:imdbId - Resolve by IMDB ID',
      'GET /api/token?movieId=xxx - Extract fresh token',
      'GET /health - Health check'
    ]
  });
});

// Serve static files (player.html)
app.use(express.static('.'));

// Start server
app.listen(PORT, () => {
  console.log(`Vidstorm Resolver Server running on http://localhost:${PORT}`);
  console.log('');
  console.log('Endpoints:');
  console.log(`  http://localhost:${PORT}/api/movie/557`);
  console.log(`  http://localhost:${PORT}/api/imdb/tt0145487`);
  console.log(`  http://localhost:${PORT}/api/token?movieId=557`);
  console.log('');
  console.log('Press Ctrl+C to stop');
});
