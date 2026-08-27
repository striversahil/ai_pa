// Generates PWA icons from a brand SVG (gradient rounded square + chat bubble).
import sharp from "sharp";
import { mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function iconSvg(size, maskable) {
  const s = size;
  const rx = maskable ? Math.round(s * 0.22) : Math.round(s * 0.18);
  const bubbleW = Math.round(s * 0.56);
  const bubbleH = Math.round(s * 0.4);
  const bubbleX = Math.round(-(s * 0.28));
  const bubbleY = Math.round(-(s * 0.22));
  const bubbleRx = Math.round(s * 0.09);
  const tail = Math.round(s * 0.12);
  const dots = [s * 0.1, s * 0.02, s * -0.14].map((x) => Math.round(x));
  const dotR = Math.round(s * 0.025);
  const dotY = Math.round(-(s * 0.02));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  <rect width="${s}" height="${s}" rx="${rx}" fill="url(#g)"/>
  <g transform="translate(${Math.round(s / 2)} ${Math.round(s / 2)})">
    <rect x="${bubbleX}" y="${bubbleY}" width="${bubbleW}" height="${bubbleH}" rx="${bubbleRx}" fill="#ffffff"/>
    <polygon points="${bubbleX},${bubbleY + bubbleH} ${bubbleX + tail},${bubbleY + bubbleH} ${bubbleX},${bubbleY + bubbleH + tail}" fill="#ffffff"/>
    ${dots.map((x) => `<circle cx="${x}" cy="${dotY}" r="${dotR}" fill="#8b5cf6"/>`).join("\n    ")}
  </g>
</svg>`;
}

const targets = [
  ["icon-512.png", 512, false],
  ["icon-192.png", 192, false],
  ["icon-maskable-512.png", 512, true],
  ["icon-maskable-192.png", 192, true],
  ["apple-touch-icon.png", 180, false],
  ["favicon-32.png", 32, false],
];

mkdirSync(join(root, "public/icons"), { recursive: true });
for (const [name, size, maskable] of targets) {
  await sharp(Buffer.from(iconSvg(size, maskable)))
    .png()
    .toFile(join(root, "public/icons", name));
}
console.log("icons generated:", readdirSync(join(root, "public/icons")).join(", "));