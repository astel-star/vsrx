#!/usr/bin/env node
/**
 * Vidstorm Resolver - Automatic Token Extraction (Uses existing Chrome)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const puppeteer = require('puppeteer-core');

const app = express();
const PORT = process.env.PORT || 8080;
const TMDB_API_KEY = "54e00466a09676df57ba51c4ca30b1a6";

app.use(cors());
app.use(express.json());

// Find Chrome/Edge path
const getChromePath = () => {
  if (process.platform === 'win32') {
    const fs = require('fs');
    const paths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of paths) {
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
};

async function extractToken(tmdbId) {
  const chromePath = getChromePath();
  if (!chromePath) {
    throw new Error('Chrome/Edge not found. Install Chrome or use manual token mode.');
  }
  
  console.log(`[Auto] Using Chrome: ${chromePath}`);
  
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  
  const page = await browser.newPage();
  let token = null;
  
  page.on('request', request => {
    const url = request.url();
    const match = url.match(/\/api\/(?:movie|tv)\/([A-Za-z0-9_-]{20,40})/);
    if (match && !token) {
      token = match[1];
      console.log(`[Auto] Captured token: ${token}`);
    }
  });
  
  await page.goto(`https://vidstorm.ru/movie/${tmdbId}`, { 
    waitUntil: 'networkidle2', 
    timeout: 30000 
  });
  
  await page.waitForTimeout(2000);
  await browser.close();
  
  return token;
}

async function getTmdbMetadata(tmdbId) {
  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
  } catch (e) {
    return null;
  }
}

async function fetchStreams(tmdbId, token) {
  const result = {
    movie_id: tmdbId,
    token: token,
    token_source: token ? 'auto' : 'missing',
    sources: [],
    subtitles: [],
    metadata: null
  };
  
  const metadata = await getTmdbMetadata(tmdbId);
  if (metadata) {
    result.metadata = {
      title: metadata.title,
      poster: metadata.poster_path ? `https://image.tmdb.org/t/p/w500${metadata.poster_path}` : null,
      release_date: metadata.release_date
    };
  }
  
  if (!token) {
    result.error = 'No token available';
    return result;
  }
  
  try {
    const apiUrl = `https://vidstorm.ru/api/movie/${token}`;
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': `https://vidstorm.ru/movie/${tmdbId}`,
        'Origin': 'https://vidstorm.ru'
      },
      timeout: 15000
    });
    
    if (response.status === 200) {
      for (const [name, source] of Object.entries(response.data)) {
        if (source?.url) {
          result.sources.push({ name, url: source.url, type: source.type, language: source.language });
        }
      }
    }
  } catch (e) {
    result.error = e.message;
  }
  
  return result;
}

// API Endpoints
app.get('/api/movie/:tmdbId', async (req, res) => {
  const tmdbId = req.params.tmdbId;
  let token = req.query.token;
  
  console.log(`[Request] /api/movie/${tmdbId}`);
  
  if (!token) {
    try {
      console.log('[Request] Auto-extracting token with Chrome...');
      token = await extractToken(tmdbId);
    } catch (e) {
      console.log(`[Request] Auto-extraction failed: ${e.message}`);
    }
  }
  
  const result = await fetchStreams(tmdbId, token);
  res.json(result);
});

app.get('/health', (req, res) => {
  const chromePath = getChromePath();
  res.json({
    status: 'ok',
    chrome_found: !!chromePath,
    chrome_path: chromePath,
    auto_extraction: !!chromePath
  });
});

app.use(express.static('.'));

app.listen(PORT, () => {
  console.log(`Vidstorm Resolver (Auto) on http://localhost:${PORT}`);
  console.log('');
  const chromePath = getChromePath();
  if (chromePath) {
    console.log('✅ Chrome found - Auto-extraction enabled');
    console.log(`   ${chromePath}`);
  } else {
    console.log('⚠️ Chrome not found - Install Chrome or use manual token');
  }
  console.log('');
  console.log('Test: curl http://localhost:' + PORT + '/api/movie/557');
});
