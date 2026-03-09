const express = require('express');
const puppeteer = require('puppeteer-core');
const app = express();

// Use Render's port or fallback to 10000
const PORT = process.env.PORT || 10000;

// YOUR BROWSERLESS TOKEN INTEGRATED
const BROWSERLESS_TOKEN = '2U7ETRjJfkwXjAIa9c859d15f97834eb3cfae0e319b3b0fa6';
const BROWSER_WSE = `wss://chrome.browserless.io?token=${BROWSERLESS_TOKEN}`;

app.get('/resolve', async (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).send('No URL provided');

    let browser;
    try {
        console.log(`Starting resolution for: ${targetUrl}`);
        
        browser = await puppeteer.connect({ 
            browserWSEndpoint: BROWSER_WSE,
            defaultViewport: { width: 1280, height: 720 }
        });
        
        let page = (await browser.pages())[0];
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

        try {
            console.log("Searching for watch triggers...");
            await page.waitForFunction(() => {
                const triggers = Array.from(document.querySelectorAll('a, button, .btn'));
                return triggers.some(el => 
                    el.innerText.includes('مشاهدة') || 
                    el.innerText.includes('Watch') || 
                    el.className.includes('watch') ||
                    el.href?.includes('watch')
                );
            }, { timeout: 25000 });

            const newTabPagePromise = new Promise(x => browser.once('targetcreated', target => x(target.page())));

            await page.evaluate(() => {
                const triggers = Array.from(document.querySelectorAll('a, button, .btn'));
                const target = triggers.find(el => 
                    el.innerText.includes('مشاهدة') || 
                    el.innerText.includes('Watch') || 
                    el.className.includes('watch') ||
                    el.href?.includes('watch')
                );
                if (target) target.click();
            });

            const newPage = await Promise.race([
                newTabPagePromise,
                new Promise(resolve => setTimeout(() => resolve(null), 5000))
            ]);

            if (newPage) {
                console.log("New tab detected. Switching focus...");
                page = newPage; 
                await page.bringToFront();
            }
        } catch (e) {
            console.log("Click failed. Attempting direct URL guessing...");
            const watchUrl = targetUrl.replace('/movie/', '/watch/');
            await page.goto(watchUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        }

        await new Promise(resolve => setTimeout(resolve, 8000)); 
        
        const frames = page.frames();
        let videoSource = null;

        for (const frame of frames) {
            try {
                const playIcon = await frame.$('.jw-icon-display, .vjs-big-play-button');
                if (playIcon) await playIcon.click();

                videoSource = await frame.evaluate(() => {
                    const video = document.querySelector('video');
                    if (video && video.src && video.src.startsWith('http')) return video.src;
                    
                    const scripts = Array.from(document.querySelectorAll('script')).map(s => s.innerText);
                    for (const s of scripts) {
                        const match = s.match(/file\s*:\s*["'](http.*?\.(m3u8|mp4|ts|mkv).*?)["']/i);
                        if (match) return match[1];
                    }
                    return null;
                });
                if (videoSource) break;
            } catch (e) { continue; }
        }

        if (videoSource) {
            res.send(videoSource);
        } else {
            res.status(404).send('Could not find video link.');
        }

    } catch (error) {
        console.error("Critical Error:", error.message);
        res.status(500).send('Server Error: ' + error.message);
    } finally {
        if (browser) await browser.disconnect();
    }
});

// ADDED: Root route to check if server is alive
app.get('/', (req, res) => res.send('REX Bridge is Online!'));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Rex Bridge Server active on port ${PORT}`);
});
