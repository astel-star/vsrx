#!/usr/bin/env node
/**
 * Lightweight Token Extractor - Uses existing Chrome/Edge
 * No Chromium download required!
 */

const puppeteer = require('puppeteer-core');

// Find Chrome/Edge executable
const getChromePath = () => {
  const platform = process.platform;
  
  if (platform === 'win32') {
    // Windows - Chrome or Edge
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ].find(require('fs').existsSync);
  }
  
  if (platform === 'darwin') {
    // macOS
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  
  // Linux
  return '/usr/bin/google-chrome';
};

async function extractToken(tmdbId) {
  const chromePath = getChromePath();
  
  if (!chromePath) {
    console.error('❌ Chrome/Edge not found! Install Chrome or use manual token method.');
    return null;
  }
  
  console.log(`[Token Extractor] Using Chrome at: ${chromePath}`);
  
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  const page = await browser.newPage();
  
  let token = null;
  
  // Intercept network requests
  page.on('request', request => {
    const url = request.url();
    const match = url.match(/\/api\/(?:movie|tv)\/([A-Za-z0-9_-]{20,40})/);
    if (match && !token) {
      token = match[1];
      console.log(`[Token Extractor] ✓ Found: ${token}`);
    }
  });
  
  // Load page
  const url = `https://vidstorm.ru/movie/${tmdbId}`;
  console.log(`[Token Extractor] Loading ${url}...`);
  
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForTimeout(3000);
  
  await browser.close();
  return token;
}

// CLI
async function main() {
  const tmdbId = process.argv[2] || '557';
  
  console.log('='.repeat(50));
  console.log(`Extracting token for movie ${tmdbId}`);
  console.log('='.repeat(50));
  
  const token = await extractToken(tmdbId);
  
  if (token) {
    console.log('\n✅ SUCCESS!');
    console.log(`Token: ${token}`);
    console.log(`\nUse with:`);
    console.log(`  curl "http://localhost:8080/api/movie/${tmdbId}?token=${token}"`);
  } else {
    console.log('\n❌ Failed to extract token');
    console.log('Make sure Chrome/Edge is installed');
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { extractToken };
