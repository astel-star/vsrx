# Deployment Guide

## Deploy to Railway (Recommended)

Railway provides free hosting for Node.js apps with full streaming support.

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git push origin main
```

### 2. Deploy on Railway
1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repo
4. Railway will auto-detect Node.js and deploy

### 3. Set Environment Variables
In Railway dashboard, add:
- `BASE_URL`: `https://your-app-name.up.railway.app`
- `TMDB_API_KEY`: `your_tmdb_key` (if using custom key)

### 4. Get Your URL
After deployment, Railway gives you a URL like:
```
https://vidstorm-addon.up.railway.app
```

### 5. Use in Stremio
Install the addon:
```
https://your-app.up.railway.app/manifest.json
```

**Now all streams (Boron, Lithium, Hydrogen) work in Stremio!** 🎉

---

## Deploy to Render (Recommended - 100GB Bandwidth!)

**Why Render?** 100GB/month bandwidth vs Railway's 5GB. Perfect for streaming!

### 1. Push to GitHub
```bash
git init
git add .
git commit -m "Ready for Render deployment"
git push origin main
```

### 2. Deploy on Render
1. Go to [render.com](https://render.com)
2. Click "New Web Service"
3. Connect your GitHub repo
4. Render auto-detects `render.yaml` or use these settings:
   - **Build Command**: `npm install`
   - **Start Command**: `node stremio-addon/addon.js`
   - **Environment Variable**: `BASE_URL=https://your-service-name.onrender.com`

### 3. Get Your URL
After deployment:
```
https://your-service-name.onrender.com
```

### 4. Use in Stremio
```
https://your-service-name.onrender.com/manifest.json
```

### 5. Keep It Awake with UptimeRobot (FREE)

Render sleeps after 15 min of inactivity. Use UptimeRobot to ping it every 10 minutes:

1. Go to [uptimerobot.com](https://uptimerobot.com)
2. Sign up (free)
3. Click "Add New Monitor"
4. Settings:
   - **Monitor Type**: HTTP(s)
   - **Friendly Name**: Vidstorm Addon
   - **URL**: `https://your-service-name.onrender.com/health`
   - **Monitoring Interval**: 10 minutes (max for free tier)
5. Click "Create Monitor"

**Done!** Your addon stays awake 24/7 for free!

---

## Local Development

```bash
cd stremio-addon
npm install
node addon.js
```

Access at: `http://localhost:7000/manifest.json`

---

## How It Works

| Environment | Boron | Lithium | Hydrogen |
|------------|-------|---------|----------|
| **Localhost** | ✅ Direct | ❌ Blocked* | ❌ Blocked* |
| **Cloud Deployed** | ✅ Direct | ✅ Proxied | ✅ Proxied |

*Stremio blocks localhost URLs in video player for security.

When deployed to the cloud:
- All streams route through `https://your-app.com/proxy`
- Stremio can access HTTPS proxy URLs
- Proxy adds required headers for each CDN
- **All sources work!**

---

## Free Tier Limits

- **Railway**: $5/month free, sleeps after inactivity
- **Render**: Free tier, sleeps after 15 min inactivity
- **Fly.io**: $5/month free credit

For best results with streaming, use Railway or upgrade to paid tier.
