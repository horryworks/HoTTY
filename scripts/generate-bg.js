const fs = require('fs');
const path = require('path');

const width = 800;
const height = 800;

let svgContent = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="grad" cx="50%" cy="50%" r="80%" fx="50%" fy="50%">
      <stop offset="0%" style="stop-color:#000010;stop-opacity:1" />
      <stop offset="60%" style="stop-color:#050015;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#100020;stop-opacity:1" />
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#grad)" />
`;

// Generate random lines (data streams)
const lineCount = 400;
for (let i = 0; i < lineCount; i++) {
    const x1 = Math.random() * width;
    const y1 = Math.random() * height;
    const length = 20 + Math.random() * 100;
    const isVertical = Math.random() > 0.3; // Mostly vertical

    let x2 = x1;
    let y2 = y1;

    if (isVertical) {
        y2 = y1 + length;
        if (Math.random() > 0.8) x2 = x1 + (Math.random() - 0.5) * 20; // Slight diagonal
    } else {
        x2 = x1 + length;
        if (Math.random() > 0.8) y2 = y1 + (Math.random() - 0.5) * 20;
    }

    const hue = Math.random() > 0.6 ? 280 : 190; // Purple (280) or Cyan (190)
    const color = `hsl(${hue}, 80%, 50%)`;
    const opacity = 0.1 + Math.random() * 0.4;
    const strokeWidth = 0.5 + Math.random() * 1.5;

    svgContent += `<path d="M ${x1} ${y1} L ${x2} ${y2}" stroke="${color}" stroke-width="${strokeWidth}" opacity="${opacity}" />\n`;
}

// Generate random nodes/particles
const nodeCount = 150;
for (let i = 0; i < nodeCount; i++) {
    const cx = Math.random() * width;
    const cy = Math.random() * height;
    const r = 0.5 + Math.random() * 2;
    const hue = Math.random() > 0.5 ? 280 : 180;
    const color = `hsl(${hue}, 90%, 60%)`;
    const opacity = 0.2 + Math.random() * 0.6;

    // Some animated
    if (Math.random() > 0.7) {
        const dur = 1 + Math.random() * 4;
        svgContent += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${opacity}">
          <animate attributeName="opacity" values="${opacity};${opacity * 0.2};${opacity}" dur="${dur}s" repeatCount="indefinite" />
        </circle>\n`;
    } else {
        svgContent += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" opacity="${opacity}" />\n`;
    }
}

svgContent += `</svg>`;

const outputPath = path.join(__dirname, '../public/bg-cyberspace.svg');
fs.writeFileSync(outputPath, svgContent);
console.log(`Generated SVG at ${outputPath}`);
