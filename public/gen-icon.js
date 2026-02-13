const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

// Basic script to render SVG and save as PNG
app.on('ready', async () => {
    try {
        const win = new BrowserWindow({
            width: 512,
            height: 512,
            show: false,
            webPreferences: {
                offscreen: true,
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        const svgPath = path.join(__dirname, 'icon.svg');
        const content = fs.readFileSync(svgPath, 'utf8');
        const dataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;

        await win.loadURL(dataUrl);

        // Wait for rendering
        await new Promise(resolve => setTimeout(resolve, 2000));

        const image = await win.capturePage({ x: 0, y: 0, width: 512, height: 512 });
        fs.writeFileSync(path.join(__dirname, 'icon.png'), image.toPNG());
        console.log('---SUCCESS---');
        app.quit();
    } catch (err) {
        console.error('FAILED:', err);
        app.exit(1);
    }
});
