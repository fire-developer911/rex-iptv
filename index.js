const express = require('express');
const puppeteer = require('puppeteer-core'); // Use remote connection
const app = express();
const PORT = process.env.PORT || 3000;

// Get your API key from browserless.io (they have a free tier)
const BROWSERLESS_TOKEN = '2U7ETRjJfkwXjAIa9c859d15f97834eb3cfae0e319b3b0fa6'; 

app.get('/get-stream', async (req, res) => {
    const movieIndex = parseInt(req.query.index) || 0;
    let browser;

    try {
        console.log(`Connecting to Browserless for movie index: ${movieIndex}`);
        
        // Connect to the remote browser instead of launching a local one
        browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`,
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let caughtUrl = null;

        // Sniffer
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.mp4') && !url.includes('yandex')) {
                caughtUrl = url;
                // We don't abort here to avoid crashing the remote browser's stream detection
            }
        });

        // Step 1: Navigate & Cloudflare Bypass
        await page.goto('https://shhaheid4u.net/', { waitUntil: 'networkidle2' });
        
        try { 
            await page.waitForSelector('.card-content', { timeout: 8000 }); 
        } catch { 
            await page.reload({ waitUntil: 'networkidle2' }); 
            await page.waitForSelector('.card-content'); 
        }

        // Step 2: Click movie and wait for new page
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.evaluate((idx) => {
                const movies = document.querySelectorAll('.card-content');
                if (movies[idx]) movies[idx].click();
            }, movieIndex)
        ]);

        // Step 3: Click main Download
        await page.waitForSelector('.btn.download');
        await page.click('.btn.download');

        // Step 4: Find fastved link and catch the popup tab
        await page.waitForSelector('a.btn.btn-down');
        
        // Set up the listener for the new tab
        const newTargetPromise = new Promise(resolve => browser.once('targetcreated', target => resolve(target.page())));

        await page.evaluate(() => {
            const target = Array.from(document.querySelectorAll('a.btn.btn-down')).find(b => b.href.includes('fastved.sbs'));
            if (target) target.click();
        });

        const dPage = await newTargetPromise;
        await dPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        // Step 4: streamhg internal sequence
        await dPage.waitForSelector('.downloadv-item');
        await dPage.click('.downloadv-item');
        
        await new Promise(r => setTimeout(r, 1500)); 
        await dPage.waitForSelector('.g-recaptcha.btn.btn-gr.submit-btn');
        await dPage.click('.g-recaptcha.btn.btn-gr.submit-btn');

        // Step 6: The final link generation
        await new Promise(r => setTimeout(r, 8000));
        await dPage.waitForSelector('.btn.btn-gr.submit-btn');
        await dPage.click('.btn.btn-gr.submit-btn');

        // Poll for URL
        let timeoutCount = 0;
        while (!caughtUrl && timeoutCount < 15) {
            await new Promise(r => setTimeout(r, 1000));
            timeoutCount++;
        }

        if (caughtUrl) {
            console.log("Stream URL found!");
            res.json({ success: true, url: caughtUrl });
        } else {
            res.status(404).json({ success: false, error: "Stream link timed out" });
        }

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        if (browser) await browser.disconnect(); // Always disconnect to save Browserless credits
    }
});

app.listen(PORT, () => console.log(`API Online on port ${PORT}`));

