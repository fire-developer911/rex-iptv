const express = require('express');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

// Get your free token from browserless.io
const BROWSERLESS_TOKEN = '2U7ETRjJfkwXjAIa9c859d15f97834eb3cfae0e319b3b0fa6';
const BROWSER_WSE = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`;

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    let browser;
    try {
        console.log(`Starting resolution for: ${targetUrl}`);
        
        // Connect to Remote Browser
        browser = await puppeteer.connect({ browserWSEndpoint: BROWSER_WSE });
        
        // Use the first available page
        let page = (await browser.pages())[0];
        
        // Set a realistic User-Agent to avoid bot detection
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // 1. Navigate to the Movie Page
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // 2. Find and Click the 'Watch' button
        // We look for multiple possible selectors used by the new domain
        const watchSelectors = ['.btn.watch', 'a.watch-btn', '.watch-link', 'a[href*="watch"]'];
        
        await page.waitForFunction((selectors) => {
            return selectors.some(s => document.querySelector(s));
        }, { timeout: 20000 }, watchSelectors);

        // Logic for New Tab (Ad or Player)
        const newTabPagePromise = new Promise(x => browser.once('targetcreated', target => x(target.page())));
        
        // Click the button using evaluate to bypass overlay blocks
        await page.evaluate((selectors) => {
            for (const s of selectors) {
                const el = document.querySelector(s);
                if (el) { el.click(); return; }
            }
        }, watchSelectors);

        console.log("Clicked Watch button.");

        // Wait up to 4 seconds to see if a new tab opens
        const newPage = await Promise.race([
            newTabPagePromise,
            new Promise(resolve => setTimeout(() => resolve(null), 4000))
        ]);

        if (newPage) {
            console.log("New tab detected (Ad or Player). Switching focus...");
            page = newPage; 
            await page.bringToFront();
        }

        // 3. Give the player time to load iframes
        await new Promise(resolve => setTimeout(resolve, 6000)); 
        
        // 4. Search all frames for the video source
        const frames = page.frames();
        let videoSource = null;

        console.log(`Searching across ${frames.length} frames...`);

        for (const frame of frames) {
            try {
                // Try to click the JW Player play icon if present
                const playButton = await frame.$('.jw-icon-display');
                if (playButton) await playButton.click();

                // Extract the direct video source
                videoSource = await frame.evaluate(() => {
                    // Try to find the <video> tag source
                    const video = document.querySelector('video');
                    if (video && video.src && video.src.startsWith('http')) return video.src;
                    
                    // Look for common m3u8/mp4 patterns in scripts (JW Player / VideoJS)
                    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerText);
                    for (const s of scripts) {
                        const match = s.match(/file\s*:\s*["'](http.*?\.(m3u8|mp4|ts|mkv).*?)["']/i);
                        if (match) return match[1];
                        
                        // Fallback for some encoded sources
                        const sourceMatch = s.match(/sources\s*:\s*\[\s*\{\s*file\s*:\s*["'](http.*?)["']/i);
                        if (sourceMatch) return sourceMatch[1];
                    }
                    return null;
                });

                if (videoSource) break;
            } catch (e) { continue; }
        }

        if (videoSource) {
            console.log("Found Video Link: " + videoSource);
            res.send(videoSource);
        } else {
            console.log("Failed to find source in frames.");
            res.status(404).send('Could not find video link. The player might be blocked or require interaction.');
        }

    } catch (error) {
        console.error("Resolution Error:", error.message);
        res.status(500).send('Error: ' + error.message);
    } finally {
        if (browser) {
            // Use disconnect instead of close for faster performance with browserless
            await browser.disconnect();
        }
    }
});

app.listen(PORT, () => {
    console.log(`Rex Bridge Server running on port ${PORT}`);
});
