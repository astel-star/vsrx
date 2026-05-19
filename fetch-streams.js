#!/usr/bin/env node
/**
 * One-Shot Stream Fetcher
 * Extracts token and immediately fetches streams (token may expire in seconds)
 */

const axios = require('axios');

// TMDB API Key
const TMDB_API_KEY = "54e00466a09676df57ba51c4ca30b1a6";

// Try to import puppeteer-core
try {
  var puppeteer = require('puppeteer-core');
} catch (e) {
  console.error('❌ puppeteer-core not installed');
  console.error('Run: npm install puppeteer-core');
  process.exit(1);
}

// Find Chrome/Edge
function getChromePath() {
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
  return null;
}

async function fetchStreams(tmdbId) {
  const startTime = Date.now();
  
  console.log('='.repeat(60));
  console.log(`Fetching streams for TMDB ID: ${tmdbId}`);
  console.log('='.repeat(60));
  
  // Step 1: Get TMDB metadata
  console.log('\n[1/4] Fetching TMDB metadata...');
  let metadata = null;
  try {
    const resp = await axios.get(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${TMDB_API_KEY}`,
      { timeout: 10000 }
    );
    metadata = resp.data;
    console.log(`  ✓ ${metadata.title} (${metadata.release_date})`);
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
  }
  
  // Step 2: Extract token with headless browser
  console.log('\n[2/4] Extracting token with browser...');
  const chromePath = getChromePath();
  if (!chromePath) {
    console.error('  ✗ Chrome/Edge not found!');
    return null;
  }
  
  let token = null;
  let browser = null;
  
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions'
      ]
    });
    
    const page = await browser.newPage();
    
    // Capture token from network requests
    page.on('request', request => {
      const url = request.url();
      const match = url.match(/\/api\/(?:movie|tv)\/([A-Za-z0-9_-]{20,40})/);
      if (match && !token) {
        token = match[1];
        console.log(`  ✓ Token captured: ${token.substring(0, 20)}...`);
      }
    });
    
    // Navigate to movie page
    const movieUrl = `https://vidstorm.ru/movie/${tmdbId}`;
    console.log(`  Loading ${movieUrl}...`);
    
    await page.goto(movieUrl, { 
      waitUntil: 'networkidle2',
      timeout: 30000 
    });
    
    // Wait for API call
    await page.waitForTimeout(2000);
    
    await browser.close();
    browser = null;
    
    if (!token) {
      console.error('  ✗ Token not captured');
      return null;
    }
    
  } catch (e) {
    console.error(`  ✗ Browser error: ${e.message}`);
    if (browser) await browser.close();
    return null;
  }
  
  // Step 3: IMMEDIATELY use the token (may expire in seconds)
  console.log('\n[3/4] Fetching streams (using token immediately)...');
  const tokenTime = Date.now() - startTime;
  console.log(`  Token age: ${tokenTime}ms`);
  
  let streams = null;
  try {
    const apiUrl = `https://vidstorm.ru/api/movie/${token}`;
    const resp = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
        'Referer': `https://vidstorm.ru/movie/${tmdbId}`,
        'Origin': 'https://vidstorm.ru'
      },
      timeout: 10000
    });
    
    if (resp.status === 200) {
      streams = resp.data;
      const sourceCount = Object.values(streams).filter(s => s?.url).length;
      console.log(`  ✓ API returned ${Object.keys(streams).length} entries, ${sourceCount} with URLs`);
    }
  } catch (e) {
    console.error(`  ✗ API error: ${e.message}`);
  }
  
  // Step 4: Fetch subtitles
  console.log('\n[4/4] Fetching subtitles...');
  let subtitles = [];
  try {
    const resp = await axios.get(
      `https://sub.vdrk.site/v2/movie/${tmdbId}`,
      { timeout: 10000 }
    );
    if (resp.status === 200) {
      subtitles = resp.data;
      console.log(`  ✓ ${subtitles.length} subtitles found`);
    }
  } catch (e) {
    console.log('  ✗ No subtitles');
  }
  
  // Build result
  const result = {
    movie_id: tmdbId,
    token: token,
    token_age_ms: tokenTime,
    metadata: metadata ? {
      title: metadata.title,
      overview: metadata.overview,
      poster: metadata.poster_path ? `https://image.tmdb.org/t/p/w500${metadata.poster_path}` : null,
      release_date: metadata.release_date,
      runtime: metadata.runtime
    } : null,
    sources: [],
    subtitles: subtitles
  };
  
  if (streams) {
    for (const [name, source] of Object.entries(streams)) {
      if (source?.url) {
        result.sources.push({
          name: name,
          url: source.url,
          type: source.type || 'hls',
          language: source.language,
          quality: extractQuality(source.url)
        });
      }
    }
  }
  
  // Output
  const totalTime = Date.now() - startTime;
  console.log('\n' + '='.repeat(60));
  console.log(`COMPLETE in ${totalTime}ms`);
  console.log('='.repeat(60));
  
  if (result.sources.length > 0) {
    console.log(`\n✅ SUCCESS! Found ${result.sources.length} stream sources:`);
    result.sources.forEach((src, i) => {
      console.log(`\n${i + 1}. ${src.name} (${src.quality})`);
      console.log(`   URL: ${src.url}`);
      if (src.language) console.log(`   Language: ${src.language}`);
    });
  } else {
    console.log('\n❌ No stream sources found');
    console.log('The token may have expired too quickly.');
  }
  
  return result;
}

function extractQuality(url) {
  const match = url.match(/(\d+)p/);
  return match ? match[1] + 'p' : 'unknown';
}

// CLI
async function main() {
  const tmdbId = process.argv[2] || '557';
  await fetchStreams(tmdbId);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
