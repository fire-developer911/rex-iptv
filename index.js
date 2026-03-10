import express from 'express';
import puppeteer from 'puppeteer-core';

const app = express();
const PORT = process.env.PORT || 3000;

const BROWSERLESS_TOKEN = '2U7ETRjJfkwXjAIa9c859d15f97834eb3cfae0e319b3b0fa6'; 

app.get('/get-stream', async (req, res) => {
    const movieIndex = parseInt(req.query.index) || 0;
    let browser;

    try {
        console.log(`🚀 Request Started | Index: ${movieIndex}`);
        
        // Connect with additional stealth arguments
        browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}&--disable-blink-features=AutomationControlled&--start-maximized`,
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        let caughtUrl = null;
        page.on('request', request => {
            const url = request.url();
            if (url.includes('.mp4') && !url.includes('yandex')) {
                caughtUrl = url;
            }
        });

        // --- STEP 1: LOAD HOME ---
        console.log("Navigating to shhaheid4u.net...");
        await page.goto('https://shhaheid4u.net/', { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Debug: What does the page look like?
        const pageTitle = await page.title();
        console.log(`Current Page Title: ${pageTitle}`);

        // Try to find movie cards with a longer wait and a retry
        let loaded = false;
        for (let i = 0; i < 2; i++) {
            try {
                console.log(`Waiting for movies (Attempt ${i + 1})...`);
                await page.waitForSelector('.card-content', { timeout: 15000 });
                loaded = true;
                break;
            } catch (e) {
                console.log("Stuck on verification/loading. Reloading page...");
                await page.reload({ waitUntil: 'networkidle2' });
            }
        }

        if (!loaded) throw new Error("Could not bypass security verification or site is down.");

        // --- STEP 2: CLICK MOVIE ---
        console.log("Step 1: Clicking movie...");
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
            page.evaluate((idx) => {
                const movies = document.querySelectorAll('.card-content');
                if (movies[idx]) movies[idx].click();
            }, movieIndex)
        ]);

        // --- STEP 3: MAIN DOWNLOAD BUTTON ---
        console.log("Step 2: Clicking Main Download...");
        await page.waitForSelector('.btn.download', { timeout: 15000 });
        await page.click('.btn.download');

        // --- STEP 4: FIND FASTVED & POPUP ---
        console.log("Step 3: Finding fastved.sbs link...");
        const newTargetPromise = new Promise(resolve => browser.once('targetcreated', target => resolve(target.page())));

        await page.waitForSelector('a.btn.btn-down', { timeout: 15000 });
        await page.evaluate(() => {
            const target = Array.from(document.querySelectorAll('a.btn.btn-down')).find(b => b.href.includes('fastved.sbs'));
            if (target) target.click();
        });

        const dPage = await newTargetPromise;
        console.log("Switched to Download Tab.");

        // --- STEP 5: STREAMHG SEQUENCE ---
        await dPage.waitForSelector('.downloadv-item', { timeout: 20000 });
        await dPage.click('.downloadv-item');
        
        console.log("Step 5: Cooldown (1.5s)...");
        await new Promise(r => setTimeout(r, 1500)); 
        await dPage.waitForSelector('.g-recaptcha.btn.btn-gr.submit-btn');
        await dPage.click('.g-recaptcha.btn.btn-gr.submit-btn');

        console.log("Step 6: Generating link (8s)...");
        await new Promise(r => setTimeout(r, 8500));
        await dPage.waitForSelector('.btn.btn-gr.submit-btn');
        await dPage.click('.btn.btn-gr.submit-btn');

        // --- FINAL POLLING ---
        let timeoutCount = 0;
        while (!caughtUrl && timeoutCount < 20) {
            await new Promise(r => setTimeout(r, 1000));
            timeoutCount++;
        }

        if (caughtUrl) {
            console.log("🎯 Link found!");
            res.json({ success: true, url: caughtUrl });
        } else {
            res.status(404).json({ success: false, error: "Stream link extraction timed out." });
        }

    } catch (err) {
        console.error(`❌ ERROR: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        if (browser) await browser.disconnect();
    }
});

app.listen(PORT, () => console.log(`API Online on port ${PORT}`));
