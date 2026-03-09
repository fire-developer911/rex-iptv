const express = require('express');
const puppeteer = require('puppeteer-core');
const app = express();
const PORT = process.env.PORT || 3000;

// Get your free token from browserless.io
const BROWSERLESS_TOKEN = '2U7ETRjJfkwXjAIa9c859d15f97834eb3cfae0e319b3b0fa6';
const BROWSER_WSE = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`;

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url; // The URL sent from your Android app
    if (!targetUrl) return res.status(400).send('No URL provided');

    let browser;
    try {
        console.log(`Resolving: ${targetUrl}`);
        browser = await puppeteer.connect({ browserWSEndpoint: BROWSER_WSE });
        
        let page = (await browser.pages())[0];
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        // 1. Wait for and Click the 'Watch' button
        await page.waitForSelector('.btn.watch', { visible: true });

        // Logic for New Tab (Ad or Player)
        const newTabPagePromise = new Promise(x => browser.once('targetcreated', target => x(target.page())));
        
        await page.click('.btn.watch');
        console.log("Clicked Watch button.");

        const newPage = await Promise.race([
            newTabPagePromise,
            new Promise(resolve => setTimeout(() => resolve(null), 4000))
        ]);

        if (newPage) {
            console.log("Switching focus to new tab...");
            page = newPage; 
            await page.bringToFront();
        }

        // 2. Wait for player to stabilize
        await new Promise(resolve => setTimeout(resolve, 5000)); 
        
        // 3. Look inside frames for the video source
        const frames = page.frames();
        let videoSource = null;

        for (const frame of frames) {
            try {
                // First, try to click the play button like your script does
                const playButton = await frame.$('.jw-icon-display');
                if (playButton) await playButton.click();

                // Now, extract the video URL from the frame's network or HTML
                videoSource = await frame.evaluate(() => {
                    const video = document.querySelector('video');
                    if (video && video.src) return video.src;
                    
                    // Look for common m3u8/mp4 patterns in scripts
                    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerText);
                    for (const s of scripts) {
                        const match = s.match(/file\s*:\s*["'](http.*?\.(m3u8|mp4|ts).*?)["']/);
                        if (match) return match[1];
                    }
                    return null;
                });

                if (videoSource) break;
            } catch (e) { continue; }
        }

        if (videoSource) {
            console.log("Successfully found video source!");
            res.send(videoSource);
        } else {
            res.status(404).send('Could not find video link inside frames');
        }

    } catch (error) {
        console.error("Error:", error);
        res.status(500).send('Error: ' + error.message);
    } finally {
        if (browser) await browser.disconnect();
    }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));