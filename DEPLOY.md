# Instamart Category Scraper - Render Deployment Guide

## 🚀 Deploy Using Docker

Your Instamart scraper **MUST** be deployed using Docker runtime. The Node.js environment has browser installation path issues.

### Changes Made

✅ **Enabled headless mode** - Removed Brave browser dependency  
✅ **Dynamic PORT** - Uses `process.env.PORT` for Render  
✅ **Docker deployment** - Uses official Playwright image  
✅ **Render configuration** - `render.yaml` + `Dockerfile` created  

---

## Deployment Steps

### Step 1: Delete Existing Service (If Already Deployed)

If you already deployed with Node.js environment:

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Find `instamart-category-scraper`
3. **Settings** → **Delete Web Service**

### Step 2: Commit and Push

```bash
git add Dockerfile render.yaml package.json server.js .dockerignore .gitignore
git commit -m "Add Docker deployment for Instamart scraper"
git push origin main
```

### Step 3: Deploy to Render

**Option A: Using Dashboard**

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. **IMPORTANT Settings**:
   - **Environment**: Select **Docker** (NOT Node)
   - **Dockerfile Path**: `./Dockerfile`
   - **Name**: `instamart-category-scraper`
   - **Plan**: Free (or paid)
5. Click **"Create Web Service"**

**Option B: Using Blueprint**

1. Push code with `render.yaml` and `Dockerfile`
2. In Render: **New +** → **Blueprint**
3. Connect repository
4. Render will use `render.yaml` automatically

---

## Testing Your Deployment

Once deployed, Render provides a URL like:
```
https://instamart-category-scraper.onrender.com
```

Test with:
```bash
curl -X POST https://your-app.onrender.com/instamartcategorywrapper \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.swiggy.com/instamart/category/fresh-vegetables-5",
    "pincode": "122016"
  }'
```

---

## Session Management (Optional)

If using pincode-based sessions, generate them locally first:

1. **Temporarily set headless to false** in `server.js` (line 354)
2. **Run local server**: `npm start`
3. **Make test request** to create session
4. **Re-enable headless mode**
5. **Commit sessions folder**: `git add sessions/ && git commit -m "Add sessions"`
6. **Push and redeploy**

---

## Important Notes

### ⚠️ Docker is Required
- Node.js environment has Playwright browser path issues
- Docker image includes all system dependencies
- More reliable and consistent

### 🔧 Performance
- **First request**: 30-60 seconds (cold start)
- **Scraping time**: Several minutes for large categories
- **Memory**: Playwright requires significant memory
- **Paid tier recommended** for production

### 🐛 Troubleshooting

**Issue**: "Executable doesn't exist" error
- **Solution**: Make sure you selected **Docker** runtime, not Node.js

**Issue**: Build takes too long
- **Solution**: Normal for first build. Subsequent builds use cached layers.

**Issue**: "Location mismatch" in logs
- **Solution**: Session file doesn't match pincode. Regenerate locally.

---

## API Endpoint

**POST** `/instamartcategorywrapper`

**Request**:
```json
{
  "url": "https://www.swiggy.com/instamart/category/...",
  "pincode": "122016"
}
```

**Response**:
```json
{
  "products": [...],
  "count": 150,
  "file": "..."
}
```
