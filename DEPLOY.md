# Instamart Category Scraper - Render Deployment Guide

## 🚀 Quick Deploy to Render

Your Instamart scraper is now ready for Render deployment!

### Changes Made

✅ **Enabled headless mode** - Removed Brave browser dependency  
✅ **Dynamic PORT** - Uses `process.env.PORT` for Render  
✅ **Auto-install Playwright** - Browsers install automatically  
✅ **Render configuration** - `render.yaml` created  

---

## Deployment Steps

### Step 1: Generate Session Files (If Using Pincodes)

If your scraper requires pincode-based sessions, generate them locally first:

1. **Temporarily disable headless** in `server.js` (line 352):
   ```javascript
   headless: false,  // Change from true to false
   ```

2. **Run a test scrape** to create session:
   ```bash
   # Make a POST request to your local server
   curl -X POST http://localhost:4400/instamartcategorywrapper \
     -H "Content-Type: application/json" \
     -d '{"url": "https://www.swiggy.com/instamart/category/...", "pincode": "122016"}'
   ```

3. **Session files** will be saved in `sessions/` folder

4. **Re-enable headless mode**:
   ```javascript
   headless: true,  // Change back to true
   ```

5. **Commit session files**:
   ```bash
   git add sessions/
   git commit -m "Add session files"
   ```

### Step 2: Deploy to Render

1. **Push your code** to GitHub:
   ```bash
   git add .
   git commit -m "Prepare Instamart scraper for Render deployment"
   git push origin main
   ```

2. **Go to Render Dashboard**: https://dashboard.render.com/

3. **Create New Web Service**:
   - Click **"New +"** → **"Web Service"**
   - Connect your GitHub repository
   - Select the `instamart-category-scrapper` folder (if monorepo)

4. **Configure Service**:
   - **Name**: `instamart-category-scraper`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free (or paid for better performance)

5. **Deploy**: Click **"Create Web Service"**

---

## Testing Your Deployment

Once deployed, Render will provide a URL like:
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

## Important Notes

### ⚠️ Session Management
- **Sessions are pincode-specific**: Each pincode needs its own session file
- **Location must match**: The scraper validates that the page location matches the requested pincode
- **Session files must be committed**: Include `sessions/` folder in your repository

### 🔧 Performance Considerations
- **First request is slow**: Render's free tier spins down after inactivity (~15 min)
- **Scraping takes time**: The auto-scroll logic can take several minutes for large categories
- **Memory usage**: Playwright/Chromium requires significant memory
- **Consider paid tier**: For production use, upgrade to a paid plan for:
  - No spin-down
  - More memory
  - Faster performance

### 📊 Expected Response
The API returns:
```json
{
  "products": [...],
  "count": 150,
  "file": "/path/to/scraped_data_122016_timestamp.json"
}
```

### 🐛 Troubleshooting

**Issue**: "Executable doesn't exist" error
- **Solution**: Make sure `postinstall` script ran. Check build logs for errors.

**Issue**: "Location mismatch" in logs
- **Solution**: Session file doesn't match the pincode. Regenerate session locally.

**Issue**: Request timeout
- **Solution**: Category has too many products. Consider:
  - Limiting scroll time (reduce `maxTime` in `autoScroll`)
  - Using a paid Render plan with longer timeouts

**Issue**: "Browser launch failed"
- **Solution**: Check that headless mode is enabled and no local paths are hardcoded

---

## Environment Variables (Optional)

Set in Render Dashboard under "Environment":
- `NODE_ENV=production`
- `PORT` (automatically set by Render)

---

## File Cleanup

The scraper automatically cleans up temporary JSON files after each run:
- `api_success_*.json`
- `latest_filter_api.json`
- `initial_state_dump.json`

Scraped data files (`scraped_data_*.json`) are preserved for debugging.

---

## Next Steps

1. ✅ Commit and push all changes
2. ✅ Deploy to Render
3. ✅ Test with sample category URL
4. 🔄 Monitor logs for any issues
5. 🔄 Optimize scroll settings if needed

---

## API Endpoint

**POST** `/instamartcategorywrapper`

**Request Body**:
```json
{
  "url": "https://www.swiggy.com/instamart/category/...",
  "pincode": "122016"  // Optional
}
```

**Response**:
```json
{
  "products": [
    {
      "productId": "...",
      "productName": "...",
      "currentPrice": 99,
      "originalPrice": 120,
      "discountPercentage": 17,
      "productImage": "https://...",
      "productWeight": "500g",
      "rating": 4.2,
      "isOutOfStock": false,
      "productUrl": "https://www.swiggy.com/instamart/item/...",
      "platform": "instamart",
      "deliveryTime": "10 mins",
      "ranking": 1
    }
  ],
  "count": 150,
  "file": "..."
}
```
