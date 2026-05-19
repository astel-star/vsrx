#!/usr/bin/env node
/**
 * Vidstorm Resolver Server - Simple Version (No Playwright)
 * Requires manual token input from browser bookmarklet
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');

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
  
  if (!token) {
    result.error = 'No token provided. Use browser bookmarklet to get token from vidstorm.ru/movie/' + tmdbId;
    result.instructions = [
      '1. Visit https://vidstorm.ru/movie/' + tmdbId,
      '2. Use bookmarklet to copy token',
      '3. Call: /api/movie/' + tmdbId + '?token=YOUR_TOKEN'
    ];
    return result;
  }
  
  // Fetch streams
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
    result.error = `API error: ${error.message}`;
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
  const token = req.query.token;
  
  console.log(`[Request] /api/movie/${tmdbId}${token ? '?token=xxx' : ''}`);
  
  const result = await fetchStreams(tmdbId, token);
  result.token_source = token ? 'provided' : 'missing';
  
  res.json(result);
});

/**
 * Resolve by IMDB ID
 * GET /api/imdb/:imdbId?token=xxx
 */
app.get('/api/imdb/:imdbId', async (req, res) => {
  const imdbId = req.params.imdbId;
  const token = req.query.token;
  
  try {
    // Search TMDB for this IMDB ID
    const searchUrl = `https://api.themoviedb.org/3/find/${imdbId}?api_key=${TMDB_API_KEY}&external_source=imdb_id`;
    const response = await axios.get(searchUrl, { timeout: 10000 });
    
    if (response.data.movie_results && response.data.movie_results.length > 0) {
      const tmdbId = response.data.movie_results[0].id;
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
 * Health check
 * GET /health
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vidstorm-resolver-simple',
    note: 'This version requires manual token from browser bookmarklet',
    endpoints: [
      'GET /api/movie/:tmdbId?token=xxx - Resolve with browser token',
      'GET /api/imdb/:imdbId?token=xxx - Resolve by IMDB ID',
      'GET /health - Health check'
    ],
    bookmarklet: 'javascript:(function(){const m=document.documentElement.innerHTML.match(/\\/api\\/movie\\/([A-Za-z0-9_-]{20,40})/);if(m){navigator.clipboard.writeText(m[1]).then(()=>alert("Copied: "+m[1])).catch(()=>prompt("Copy this:",m[1]));}else{alert("Token not found. Make sure video is loaded.");}})();'
  });
});

// Serve static files
app.use(express.static('.'));

// Start server
app.listen(PORT, () => {
  console.log(`Vidstorm Resolver (Simple) running on http://localhost:${PORT}`);
  console.log('');
  console.log('⚠️  This version requires manual token input');
  console.log('');
  console.log('How to use:');
  console.log('1. Visit https://vidstorm.ru/movie/557 in your browser');
  console.log('2. Use the bookmarklet to copy the token');
  console.log('3. Call: http://localhost:' + PORT + '/api/movie/557?token=YOUR_TOKEN');
  console.log('');
});
