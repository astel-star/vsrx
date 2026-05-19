#!/usr/bin/env node
/**
 * Vidstorm Stream Fetcher - Pure JavaScript
 * Standalone script to fetch streams using headless browser
 */

const axios = require('axios');
const { chromium } = require('playwright');

const TMDB_API_KEY = "54e00466a09676df57ba51c4ca30b1a6";

/**
 * Fetch TMDB metadata
 */
async function getTmdbMetadata(tmdbId) {
  try {
    const url = `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
  } catch (error) {
    console.error('TMDB error:', error.message);
    return null;
  }
}

/**
 * Extract token using headless browser
 */
async function extractToken(tmdbId) {
  console.log(`[Browser] Starting extraction for movie ${tmdbId}...`);
  
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
      console.log(`[Browser] ✓ Captured token: ${capturedToken}`);
    }
    route.continue();
  });
  
  // Load movie page
  const movieUrl = `https://vidstorm.ru/movie/${tmdbId}`;
  console.log(`[Browser] Loading ${movieUrl}...`);
  
  try {
    await page.goto(movieUrl, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    // Expected timeout
  }
  
  // Wait for API calls
  await page.waitForTimeout(5000);
  
  // Try page content as fallback
  if (!capturedToken) {
    try {
      const content = await page.content();
      const match = content.match(/\/api\/movie\/([A-Za-z0-9_-]{20,40})/);
      if (match) {
        capturedToken = match[1];
        console.log(`[Browser] ✓ Extracted from HTML: ${capturedToken}`);
      }
    } catch (e) {}
  }
  
  await browser.close();
  return capturedToken;
}

/**
 * Fetch streams for a movie
 */
async function fetchStreams(tmdbId, providedToken = null) {
  const result = {
    movie_id: tmdbId,
    token: null,
    sources: [],
    subtitles: [],
    metadata: null
  };
  
  // Get TMDB metadata
  console.log('[TMDB] Fetching metadata...');
  const metadata = await getTmdbMetadata(tmdbId);
  if (metadata) {
    result.metadata = {
      title: metadata.title,
      overview: metadata.overview,
      poster: metadata.poster_path ? `https://image.tmdb.org/t/p/w500${metadata.poster_path}` : null,
      release_date: metadata.release_date,
      runtime: metadata.runtime,
      vote_average: metadata.vote_average
    };
    console.log(`[TMDB] ✓ ${metadata.title} (${metadata.release_date})`);
  }
  
  // Get token
  let token = providedToken;
  if (!token) {
    token = await extractToken(tmdbId);
  }
  
  if (!token) {
    result.error = 'Failed to extract token';
    return result;
  }
  
  result.token = token;
  
  // Fetch streams
  const apiUrl = `https://vidstorm.ru/api/movie/${token}`;
  console.log(`[API] Fetching streams...`);
  
  try {
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': `https://vidstorm.ru/movie/${tmdbId}`,
        'Origin': 'https://vidstorm.ru'
      },
      timeout: 15000
    });
    
    if (response.status === 200) {
      const data = response.data;
      console.log(`[API] ✓ Found ${Object.keys(data).length} sources`);
      
      for (const [name, source] of Object.entries(data)) {
        if (source && source.url) {
          result.sources.push({
            name,
            url: source.url,
            type: source.type || 'hls',
            language: source.language,
            flag: source.flag
          });
        }
      }
    }
  } catch (error) {
    result.error = `API error: ${error.message}`;
  }
  
  // Fetch subtitles
  try {
    const subUrl = `https://sub.vdrk.site/v2/movie/${tmdbId}`;
    const response = await axios.get(subUrl, { timeout: 10000 });
    if (response.status === 200) {
      result.subtitles = response.data;
      console.log(`[Subtitles] ✓ Found ${result.subtitles.length} subtitles`);
    }
  } catch (e) {
    console.log('[Subtitles] ✗ None found');
  }
  
  return result;
}

/**
 * Main CLI
 */
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.log('Usage: node stream_fetcher.js <tmdb_id> [token]');
    console.log('Examples:');
    console.log('  node stream_fetcher.js 557');
    console.log('  node stream_fetcher.js 557 TWkB6xPDtW-pyk5ryfskpQ');
    process.exit(1);
  }
  
  const tmdbId = args[0];
  const token = args[1] || null;
  
  console.log('='.repeat(60));
  console.log(`Fetching streams for TMDB ID: ${tmdbId}`);
  console.log('='.repeat(60));
  console.log('');
  
  const result = await fetchStreams(tmdbId, token);
  
  console.log('');
  console.log('='.repeat(60));
  console.log('RESULT:');
  console.log('='.repeat(60));
  console.log(JSON.stringify(result, null, 2));
  
  if (result.sources.length > 0) {
    console.log('');
    console.log('✅ STREAM SOURCES:');
    result.sources.forEach((src, i) => {
      console.log(`  ${i + 1}. ${src.name} (${src.language || 'unknown'})`);
      console.log(`     URL: ${src.url.substring(0, 70)}...`);
    });
  } else {
    console.log('');
    console.log('❌ No stream sources found');
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }
  }
}

main().catch(console.error);
