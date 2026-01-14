const express = require('express');
const bodyParser = require('body-parser');
const { chromium, firefox, devices } = require('playwright');

const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4400;

app.use(bodyParser.json({ limit: '50mb' }));

const SESSION_DIR = path.join(__dirname, 'sessions');
if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR);
}

const getSessionPath = (pincode) => path.join(SESSION_DIR, `session_${pincode}.json`);

const saveSession = async (context, pincode) => {
    if (!pincode) return;
    const sessionPath = getSessionPath(pincode);
    await context.storageState({ path: sessionPath });
    console.log(`Session saved for pincode ${pincode} at ${sessionPath}`);
};

async function setupLocation(page, context, pincode) {
    if (!pincode) return;
    const sessionPath = getSessionPath(pincode);
    if (fs.existsSync(sessionPath)) {
        console.log(`Session file exists for ${pincode}, assuming it's loaded.`);
        return;
    }
    console.log(`Setting up location for pincode: ${pincode}`);
    try {
        try {
            await page.waitForSelector('div[data-testid="address-bar"]', { timeout: 5000 });
            await page.click('div[data-testid="address-bar"]');
        } catch (e) {
            console.log('Address bar not found or clickable');
        }
        try {
            await page.waitForSelector('div[data-testid="search-location"]', { timeout: 5000 });
            await page.click('div[data-testid="search-location"]');
        } catch (e) { console.log('Search location button not found.'); }

        const inputSelector = 'input[placeholder="Search for area, street name…"]';
        try {
            await page.waitForSelector(inputSelector, { timeout: 5000 });
            await page.fill(inputSelector, pincode);
        } catch (e) { console.log('Input field not found.'); }

        try {
            await page.waitForSelector('div._11n32', { timeout: 5000 });
            const results = await page.$$('div._11n32');
            if (results.length > 0) await results[0].click();
        } catch (e) { console.log('No address results.'); }

        try {
            await page.waitForTimeout(2000);
            const confirmBtn = page.getByRole('button', { name: /confirm/i });
            if (await confirmBtn.isVisible()) await confirmBtn.click();
        } catch (e) { }

        await page.waitForTimeout(3000);
        await saveSession(context, pincode);
    } catch (error) { console.error('Error in setupLocation:', error); }
}

async function autoScroll(page, minItemCount = null) {
    console.log(`Starting fast robust auto-scroll sequence... Target: ${minItemCount ? minItemCount + ' items' : 'Unlimited'}`);
    const maxTime = 300000; // 5 mins
    const startTime = Date.now();

    let lastHeight = 0;
    let stuckCount = 0;
    let ghostTryAgainCount = 0;
    const STUCK_THRESHOLD = 20;

    // Selector for counting
    const CARD_SELECTOR = 'div[data-testid="item-collection-card-full"]';

    while (Date.now() - startTime < maxTime) {
        try {
            if (page.isClosed()) break;

            // --- NEW: Check Item Count ---
            if (minItemCount) {
                const currentCount = await page.locator(CARD_SELECTOR).count();
                if (currentCount >= minItemCount) {
                    console.log(`Reached target item count (${currentCount} >= ${minItemCount}). Stopping scroll.`);
                    break;
                }
            }
            // -----------------------------

            // 1. Scroll and measure height
            const { newHeight } = await page.evaluate(() => {
                const distance = 1200;
                let scrollTarget = window;
                let maxScrollHeight = 0;

                if (document.body.scrollHeight > window.innerHeight) {
                    maxScrollHeight = document.body.scrollHeight;
                }

                const divs = document.querySelectorAll('div');
                divs.forEach(div => {
                    if (div.scrollHeight > div.clientHeight && div.clientHeight > 0 && div.scrollHeight > 300) {
                        if (div.scrollHeight > maxScrollHeight) {
                            maxScrollHeight = div.scrollHeight;
                            scrollTarget = div;
                        }
                    }
                });

                if (scrollTarget === window) {
                    window.scrollBy(0, distance);
                } else {
                    scrollTarget.scrollBy(0, distance);
                }

                return { newHeight: maxScrollHeight };
            });

            // 2. Check overlap/stuck state
            if (Math.abs(newHeight - lastHeight) < 10) {
                // Quick check for Try Again
                const tryAgainLoc = page.locator('button, div[role="button"], div[role="alert"] span').filter({ hasText: /Try Again/i }).first();

                const isVisible = await tryAgainLoc.isVisible({ timeout: 500 });

                if (isVisible) {
                    const isTrulyVisible = await tryAgainLoc.evaluate(el => {
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }).catch(() => false);

                    if (isTrulyVisible) {
                        console.log('"Try Again" button found (DOM visible). Clicking...');
                        let clickRetries = 0;
                        let shouldStopScrolling = false;

                        while (clickRetries < 3) {
                            try {
                                await tryAgainLoc.scrollIntoViewIfNeeded();

                                // Safe viewport check
                                const box = await tryAgainLoc.boundingBox();
                                const viewport = await page.viewportSize();

                                if (box && viewport) {
                                    const isOffScreen = (box.y > viewport.height || (box.y + box.height) < 0);
                                    if (isOffScreen) {
                                        console.log('Skipping off-screen "Try Again"');
                                        break;
                                    }

                                    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                                    await page.mouse.down();
                                    await page.mouse.up();
                                } else {
                                    // Fallback if no box/viewport
                                    await tryAgainLoc.click({ delay: 50, force: true });
                                }

                                await page.waitForTimeout(2000);

                                const checkHeight = await page.evaluate(() => document.body.scrollHeight);
                                if (checkHeight > newHeight) {
                                    stuckCount = 0;
                                    lastHeight = checkHeight;
                                    ghostTryAgainCount = 0;
                                    break;
                                }
                            } catch (e) {
                                if (e.message.includes('outside of the viewport')) {
                                    ghostTryAgainCount++;
                                    console.log(`Ghost "Try Again" detected (${ghostTryAgainCount}/40). Ignoring.`);
                                    if (ghostTryAgainCount > 40) {
                                        shouldStopScrolling = true;
                                    }
                                    break;
                                }
                            }
                            clickRetries++;
                        }

                        if (shouldStopScrolling) break;
                        if (stuckCount === 0) continue;
                    }
                }

                stuckCount++;
                if (stuckCount % 5 === 0) console.log(`Stuck: ${stuckCount}/${STUCK_THRESHOLD}`);

                if (stuckCount >= STUCK_THRESHOLD) {
                    console.log('Stuck limit reached. Finishing.');
                    break;
                }

                // Wiggle faster
                if (stuckCount > 1) {
                    await page.mouse.wheel(0, -100);
                    await page.waitForTimeout(200);
                    await page.mouse.wheel(0, 300);
                }

            } else {
                stuckCount = 0;
                ghostTryAgainCount = 0;
                lastHeight = newHeight;
            }

            await page.waitForTimeout(400);

        } catch (e) {
            if (e.message.includes('Target closed') || page.isClosed()) break;
            stuckCount++;
            await page.waitForTimeout(1000);
        }
    }
    console.log('Auto-scroll finished.');
}

async function extractProducts(page) {
    console.log('Skipping manual DOM scraping (User confirmed API data is sufficient)...');
    return [];
}

// --- API Processing Logic ---
function findProductInJson(obj, foundProducts = []) {
    if (!obj || typeof obj !== 'object') return;

    // Check if this object looks like a product info block
    // Swiggy usually has 'product_info' or 'data' with these fields
    // NEW: Handle camelCase keys from the dump (productId, displayName)
    if ((obj.product_id || obj.productId) && (obj.name || obj.displayName) && (obj.price || obj.variations)) {
        foundProducts.push(obj);
        return;
    }

    // Recursive search
    if (Array.isArray(obj)) {
        obj.forEach(item => findProductInJson(item, foundProducts));
    } else if (typeof obj === 'object') {
        Object.values(obj).forEach(value => findProductInJson(value, foundProducts));
    }
}

function processCapturedJson(json) {
    const rawProducts = [];
    findProductInJson(json, rawProducts);

    return rawProducts.map(item => {
        try {
            // Handle both snake_case (legacy/other API) and camelCase (new API)

            // 1. Identification
            const pid = item.productId || item.product_id;
            const name = item.displayName || item.name;

            // 2. Variations / Pricing
            let variant = item;
            if (item.variations && item.variations.length > 0) {
                variant = item.variations[0];
            }

            const priceObj = variant.price || variant.final_price || variant.offer_price;

            // Extract Price (Handle Google Money "units" or Paice)
            let currentPrice = 0;
            let originalPrice = 0;

            if (priceObj) {
                // Formatting from "units" (Rupees)
                if (priceObj.offerPrice?.units) {
                    currentPrice = parseFloat(priceObj.offerPrice.units);
                } else if (priceObj.price) { // sometimes direct
                    currentPrice = priceObj.price / 100;
                }

                if (priceObj.mrp?.units) {
                    originalPrice = parseFloat(priceObj.mrp.units);
                } else if (priceObj.store_price?.price) {
                    originalPrice = priceObj.store_price.price / 100;
                }
            }

            if (currentPrice === 0 && variant.price?.price) {
                // Fallback to direct price object if not in offerPrice
                currentPrice = variant.price.price / 100; // Assume paise if simple number
            }

            if (originalPrice === 0) originalPrice = currentPrice;

            // 3. Meta Data
            const weight = variant.quantityDescription || variant.quantity_label || variant.weight || '';
            const imageId = (variant.imageIds && variant.imageIds[0]) || variant.cloudinary_image_id || variant.image_id || '';
            const imageUrl = imageId ? `https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/${imageId}` : null;

            const isAh = item.is_sponsored || false; // Ads often not in this json, handled by DOM usually.
            const ratingVal = variant.rating?.value || item.rating?.value || item.avg_rating || 0;

            const inStock = variant.inventory?.inStock || item.inventory?.in_stock;
            const isOutOfStock = inStock === false;

            // Discount
            let discountPercentage = 0;
            if (item.offerApplied?.listingDescription) {
                // e.g. "13% OFF"
                const match = item.offerApplied.listingDescription.match(/(\d+)%/);
                if (match) discountPercentage = parseInt(match[1]);
            } else if (variant.price?.offerApplied?.listingDescription) {
                const match = variant.price.offerApplied.listingDescription.match(/(\d+)%/);
                if (match) discountPercentage = parseInt(match[1]);
            } else if (originalPrice > currentPrice) {
                discountPercentage = Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
            }

            return {
                productId: pid,
                productName: name,
                productImage: imageUrl,
                productWeight: weight,
                quantity: weight,
                deliveryTime: null,
                isAd: !!isAh,
                rating: ratingVal,
                currentPrice: currentPrice,
                originalPrice: originalPrice,
                discountPercentage: discountPercentage,
                isOutOfStock: isOutOfStock,
                productUrl: pid ? `https://www.swiggy.com/instamart/item/${pid}` : null,
                platform: "instamart",
                scrapedAt: new Date().toISOString()
            };
        } catch (e) { return null; }
    }).filter(p => p !== null);
}

app.post('/instamartcategorywrapper', async (req, res) => {
    const { url, pincode } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    console.log(`Processing URL: ${url} with pincode: ${pincode || 'none'}`);

    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars'
            ],
            ignoreDefaultArgs: ['--enable-automation']
        });

        let contextOptions = {
            viewport: null,
            isMobile: false,
            hasTouch: false
        };
        if (pincode && fs.existsSync(getSessionPath(pincode))) {
            contextOptions.storageState = getSessionPath(pincode);
        }

        const context = await browser.newContext(contextOptions);
        const page = await context.newPage();

        // Data capture store
        const capturedProducts = new Map(); // Use Map to avoid duplicates by ID

        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });

        // API Interceptor
        page.on('response', async response => {
            const resUrl = response.url();
            const resourceType = response.request().resourceType();

            // Capture Logic
            if (resUrl.includes('api/instamart/') && (resourceType === 'fetch' || resourceType === 'xhr')) {

                // Special Debug for Filter API
                if (resUrl.includes('category-listing/filter')) {
                    console.log(`!!! Intercepted FILTER API: ${resUrl} !!!`);
                    try {
                        const json = await response.json();
                        fs.writeFileSync(path.join(__dirname, 'latest_filter_api.json'), JSON.stringify(json, null, 2));
                        console.log('Saved filter API response to latest_filter_api.json');

                        // Process it
                        const parsed = processCapturedJson(json);
                        if (parsed.length > 0) {
                            console.log(`Filter API gave ${parsed.length} products.`);
                            parsed.forEach(p => capturedProducts.set(p.productId, p));
                        }
                    } catch (e) { console.log('Error saving filter API:', e.message); }
                }

                // General Listing Capture
                if (resUrl.includes('category/list') || resUrl.includes('listing') || resUrl.includes('api/instamart/item/v2/')) {
                    // console.log(`Intercepted Possible Category/Item API: ${resUrl}`);
                    try {
                        const status = response.status();
                        if (status >= 200 && status < 300) {
                            const json = await response.json();

                            // Save dump for 'item/v2' specifically as requested
                            if (resUrl.includes('api/instamart/item/v2/')) {
                                console.log(`!!! Intercepted ITEM WIDGETS API: ${resUrl} !!!`);
                                const safeName = resUrl.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
                                const filename = path.join(__dirname, `api_item_widgets_${safeName}_${Date.now()}.json`);
                                fs.writeFileSync(filename, JSON.stringify(json, null, 2));
                                console.log(`Saved Item Widgets API to: ${filename}`);
                            }

                            // Process immediately
                            const parsed = processCapturedJson(json);
                            if (parsed.length > 0) {
                                console.log(`API (List/Item) gave ${parsed.length} products.`);
                                parsed.forEach(p => {
                                    if (!capturedProducts.has(p.productId)) {
                                        capturedProducts.set(p.productId, p);
                                    }
                                });
                            }
                        }
                    } catch (e) { }
                }
            }
        });

        await page.goto('https://www.swiggy.com/instamart', { waitUntil: 'domcontentloaded' });

        // Validate Location matches Pincode
        let locationCorrect = false;
        if (pincode) {
            try {
                // Wait briefly for address bar
                const addressEl = page.locator('div[data-testid="address-bar"]');
                await addressEl.waitFor({ state: 'visible', timeout: 5000 }).catch(() => { });

                if (await addressEl.isVisible()) {
                    const addressText = await addressEl.innerText();
                    console.log(`Current Page Location: "${addressText}" | Target Pincode: ${pincode}`);
                    // Check if pincode is in the address text
                    if (addressText.includes(pincode)) {
                        locationCorrect = true;
                        console.log('Location matches!');
                    } else {
                        console.log('Location mismatch!');
                    }
                } else {
                    console.log('Address bar not visible.');
                }
            } catch (e) { console.log('Error verifying location:', e.message); }
        } else {
            // No pincode required, assume correct
            locationCorrect = true;
        }

        if (!locationCorrect && pincode) {
            console.log('Running setupLocation to fix location...');
            await setupLocation(page, context, pincode);
        }

        // --- NEW: Extract Delivery Time from Homepage ---
        let scrapedDeliveryTime = null;
        try {
            console.log('Extracting Delivery Time...');
            // Need to visit the specific page first if we aren't there.
            // But we are about to go to category. Let's do a quick visit to home if needed, 
            // OR just rely on the fact that setupLocation/initial load went to instamart.
            // User requested explicit URL:
            if (page.url() !== 'https://www.swiggy.com/instamart?entryId=1234&entryName=mainTileEntry4&v=1') {
                await page.goto('https://www.swiggy.com/instamart?entryId=1234&entryName=mainTileEntry4&v=1', { waitUntil: 'domcontentloaded' });
            }

            const deliverySelector = 'div[data-testid="address-name"] span._31zZQ';
            await page.waitForSelector(deliverySelector, { timeout: 5000 });
            scrapedDeliveryTime = await page.locator(deliverySelector).innerText();
            console.log(`Extracted Delivery Time: "${scrapedDeliveryTime}"`);
        } catch (e) {
            console.log('Could not extract delivery time:', e.message);
        }
        // ------------------------------------------------

        console.log('Navigating to category...');
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        // --- NEW: Extract Initial State (SSR Data) ---
        // often contained in __NEXT_DATA__ for Next.js apps
        try {
            console.log('Attempting to extract Initial SSR State via Script Tag...');
            const initialStateFn = async () => {
                const nextDataScript = document.getElementById('__NEXT_DATA__');
                if (nextDataScript) return JSON.parse(nextDataScript.textContent);

                // Fallback to window object just in case
                if (window.__NEXT_DATA__) return window.__NEXT_DATA__;

                return null;
            };

            const initialState = await page.evaluate(initialStateFn);

            if (initialState) {
                console.log('Found Initial State object.');

                // Debug Dump
                const debugPath = path.join(__dirname, 'initial_state_dump.json');
                fs.writeFileSync(debugPath, JSON.stringify(initialState, null, 2));
                console.log(`Saved Initial State to: ${debugPath}`);

                const ssrProducts = processCapturedJson(initialState);
                if (ssrProducts.length > 0) {
                    console.log(`Extracted ${ssrProducts.length} products from Initial State.`);
                    ssrProducts.forEach(p => {
                        if (!capturedProducts.has(p.productId)) {
                            capturedProducts.set(p.productId, p);
                        }
                    });
                } else {
                    console.log('Initial State found but processCapturedJson returned 0 products. Check structure in dump.');
                }
            } else {
                console.log('No __NEXT_DATA__ script or window object found.');
            }
        } catch (e) {
            console.log('Error extracting initial state:', e.message);
        }
        // ---------------------------------------------

        // --- NEW: Trigger First API Call Logic ---
        // User reports missing first ~26 products. 
        // Strategy: Click first product -> Close Popup -> Then Scroll.
        console.log('Attempting Click-and-Close on first product to trigger initial API...');
        try {
            // Wait for at least one card
            const cardSelector = 'div[data-testid="item-collection-card-full"]';
            await page.waitForSelector(cardSelector, { timeout: 15000 });

            const firstCard = page.locator(cardSelector).first();
            if (await firstCard.isVisible()) {
                console.log('Clicking first product...');
                await firstCard.click({ force: true });

                // Wait for popup or details
                const popupSelector = '#product-details-page-container, div._1ne2g';
                await page.waitForSelector(popupSelector, { timeout: 5000 }).catch(() => console.log('Popup did not appear or took too long (might be non-fatal)'));
                await page.waitForTimeout(1500);

                console.log('Closing popup...');
                // Try back button then escape
                const backBtn = page.locator('button[data-testid="simpleheader-back"]');
                if (await backBtn.isVisible()) {
                    await backBtn.click();
                } else {
                    await page.keyboard.press('Escape');
                }
                // Wait for list to be visible again
                await page.waitForSelector(cardSelector, { timeout: 5000 }).catch(() => { });
                await page.waitForTimeout(2000);
            }
        } catch (e) {
            console.log('Click-and-Close strategy failed:', e.message);
        }
        // ------------------------------------------

        console.log('Scrolling to trigger API calls...');
        await autoScroll(page);

        console.log('Finalizing extraction...');
        const domProducts = await extractProducts(page);
        console.log(`DOM Extracted: ${domProducts.length} | API Captured: ${capturedProducts.size}`);

        // Merge Strategy: Hybrid (DOM Skeleton + API Enrichment)
        // 1. Use DOM products as the base to ensure order and completeness relative to what user sees.
        // 2. Enhance DOM products with API data if available (better images, precise prices).
        // 3. Normalize names for matching.

        const finalProducts = [];

        // Helper to normalize strings for matching
        const normalize = (str) => str ? str.toLowerCase().replace(/[^a-z0-9]/g, '') : '';

        // Index API products for fast lookup
        const apiMapByName = new Map();
        const usedApiIds = new Set(); // Track which API items are merged with DOM

        capturedProducts.forEach(p => {
            if (p.productName) apiMapByName.set(normalize(p.productName), p);
        });

        console.log(`Merging Data... DOM: ${domProducts.length}, API: ${capturedProducts.size}`);

        domProducts.forEach(domItem => {
            const normName = normalize(domItem.productName);
            const apiMatch = apiMapByName.get(normName); // Try name match

            if (apiMatch) {
                usedApiIds.add(apiMatch.productId); // Mark as used
                // Merge: Take API details but keep DOM Structure/Rank
                finalProducts.push({
                    ...domItem, // Keep DOM basics (rank, delivery time, ad status)
                    ...apiMatch, // Overwrite with API quality (prices, image, exact name, weight)
                    ranking: domItem.ranking, // Ensure ranking is preserved from DOM
                    deliveryTime: scrapedDeliveryTime || domItem.deliveryTime, // Apply global valid time
                    scrapedAt: new Date().toISOString()
                });
            } else {
                // No API match, keep DOM item as is
                finalProducts.push({
                    ...domItem,
                    deliveryTime: scrapedDeliveryTime || domItem.deliveryTime
                });
            }
        });

        // --- NEW: Append Remaining API Products ---
        // User wants "other data from api dump" and "generate url using id"
        let nextRank = domProducts.length + 1;
        capturedProducts.forEach(apiItem => {
            if (!usedApiIds.has(apiItem.productId)) {
                // If not already merged via DOM
                finalProducts.push({
                    ...apiItem,
                    ranking: nextRank++,
                    deliveryTime: scrapedDeliveryTime, // Apply global time
                    productUrl: `https://www.swiggy.com/instamart/item/${apiItem.productId}`, // Construct URL
                    platform: "instamart",
                    scrapedAt: new Date().toISOString()
                });
            }
        });
        console.log(`Appended ${nextRank - domProducts.length - 1} extra products from API.`);
        // ------------------------------------------

        // Final Re-Ranking to ensure clean 1..N order
        finalProducts.forEach((p, i) => {
            p.ranking = i + 1;
        });

        console.log(`Final Merged Count: ${finalProducts.length}`);

        if (finalProducts.length > 0) {
            console.log('--- DEBUG: FIRST PRODUCT ---');
            console.log('NAME:', finalProducts[0].productName);
            console.log('PRICE:', finalProducts[0].currentPrice);
            console.log('----------------------------');
        }

        // SAVE FINAL JSON TO FILE
        const finalFilename = path.join(__dirname, `scraped_data_${pincode}_${Date.now()}.json`);
        fs.writeFileSync(finalFilename, JSON.stringify(finalProducts, null, 2));
        console.log(`Final data saved to: ${finalFilename}`);

        res.json({
            products: finalProducts,
            count: finalProducts.length,
            file: finalFilename
        });

        // --- NEW: Cleanup Temporary Files ---
        try {
            const files = fs.readdirSync(__dirname);
            files.forEach(file => {
                if (
                    (file.startsWith('api_success_') && file.endsWith('.json')) ||
                    file === 'latest_filter_api.json' ||
                    file === 'initial_state_dump.json'
                ) {
                    fs.unlinkSync(path.join(__dirname, file));
                    console.log(`Deleted temp file: ${file}`);
                }
            });
        } catch (cleanupError) {
            console.error('Error during file cleanup:', cleanupError);
        }
        // ------------------------------------

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: error.message });
    } finally {
        if (browser) await browser.close();
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
