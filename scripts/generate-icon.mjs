import { createCanvas } from '@napi-rs/canvas';
import { writeFileSync } from 'fs';
import { join } from 'path';

const SIZE = 1024;
const canvas = createCanvas(SIZE, SIZE);
const ctx = canvas.getContext('2d');

// --- Helper functions ---
function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function speechBubble(ctx, cx, cy, w, h, r, tailDir = 'left', tailSize = 20) {
  // Main rounded rect body
  const x = cx - w / 2;
  const y = cy - h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);

  // Tail
  if (tailDir === 'left') {
    ctx.lineTo(x + w * 0.3 + tailSize, y + h);
    ctx.lineTo(x + w * 0.2 - tailSize * 0.3, y + h + tailSize * 1.2);
    ctx.lineTo(x + w * 0.25, y + h);
  } else if (tailDir === 'right') {
    ctx.lineTo(x + w * 0.75, y + h);
    ctx.lineTo(x + w * 0.8 + tailSize * 0.3, y + h + tailSize * 1.2);
    ctx.lineTo(x + w * 0.7 - tailSize, y + h);
  } else if (tailDir === 'center') {
    ctx.lineTo(x + w * 0.55 + tailSize * 0.5, y + h);
    ctx.lineTo(x + w * 0.5, y + h + tailSize * 1.1);
    ctx.lineTo(x + w * 0.45 - tailSize * 0.5, y + h);
  }

  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// --- Rounded square clip ---
const cornerRadius = SIZE * 0.22; // iOS-style rounded corners
roundedRect(ctx, 0, 0, SIZE, SIZE, cornerRadius);
ctx.clip();

// --- Background gradient ---
const bgGrad = ctx.createLinearGradient(0, 0, SIZE, SIZE);
bgGrad.addColorStop(0, '#6366f1');   // indigo-500
bgGrad.addColorStop(0.5, '#4f46e5'); // indigo-600
bgGrad.addColorStop(1, '#3730a3');   // indigo-800
ctx.fillStyle = bgGrad;
ctx.fillRect(0, 0, SIZE, SIZE);

// --- Subtle radial glow in center ---
const glowGrad = ctx.createRadialGradient(SIZE * 0.45, SIZE * 0.4, 0, SIZE * 0.45, SIZE * 0.4, SIZE * 0.5);
glowGrad.addColorStop(0, 'rgba(165, 180, 252, 0.15)');
glowGrad.addColorStop(1, 'rgba(165, 180, 252, 0)');
ctx.fillStyle = glowGrad;
ctx.fillRect(0, 0, SIZE, SIZE);

// --- Three speech bubbles representing 3 platforms ---

// Bubble 3 (back-left, smallest) - represents one platform
ctx.save();
ctx.globalAlpha = 0.5;
ctx.shadowColor = 'rgba(30, 27, 75, 0.3)';
ctx.shadowBlur = 20;
ctx.shadowOffsetX = 0;
ctx.shadowOffsetY = 8;
speechBubble(ctx, SIZE * 0.32, SIZE * 0.38, SIZE * 0.32, SIZE * 0.24, 28, 'left', 22);
ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
ctx.fill();
ctx.restore();

// Content lines in back bubble
ctx.save();
ctx.globalAlpha = 0.3;
roundedRect(ctx, SIZE * 0.20, SIZE * 0.30, SIZE * 0.18, SIZE * 0.02, 6);
ctx.fillStyle = '#6366f1';
ctx.fill();
roundedRect(ctx, SIZE * 0.20, SIZE * 0.35, SIZE * 0.22, SIZE * 0.02, 6);
ctx.fillStyle = '#6366f1';
ctx.fill();
roundedRect(ctx, SIZE * 0.20, SIZE * 0.40, SIZE * 0.14, SIZE * 0.02, 6);
ctx.fillStyle = '#6366f1';
ctx.fill();
ctx.restore();

// Bubble 2 (middle-right) - represents second platform
ctx.save();
ctx.globalAlpha = 0.7;
ctx.shadowColor = 'rgba(30, 27, 75, 0.35)';
ctx.shadowBlur = 24;
ctx.shadowOffsetX = 0;
ctx.shadowOffsetY = 10;
speechBubble(ctx, SIZE * 0.62, SIZE * 0.34, SIZE * 0.36, SIZE * 0.28, 30, 'right', 24);
ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
ctx.fill();
ctx.restore();

// Content lines in middle bubble
ctx.save();
ctx.globalAlpha = 0.35;
// Avatar circle
ctx.beginPath();
ctx.arc(SIZE * 0.50, SIZE * 0.26, SIZE * 0.025, 0, Math.PI * 2);
ctx.fillStyle = '#4f46e5';
ctx.fill();
// Name line
roundedRect(ctx, SIZE * 0.54, SIZE * 0.245, SIZE * 0.12, SIZE * 0.015, 5);
ctx.fillStyle = '#4f46e5';
ctx.fill();
// Text lines
roundedRect(ctx, SIZE * 0.48, SIZE * 0.30, SIZE * 0.26, SIZE * 0.018, 6);
ctx.fillStyle = '#6366f1';
ctx.fill();
roundedRect(ctx, SIZE * 0.48, SIZE * 0.34, SIZE * 0.22, SIZE * 0.018, 6);
ctx.fillStyle = '#6366f1';
ctx.fill();
roundedRect(ctx, SIZE * 0.48, SIZE * 0.38, SIZE * 0.16, SIZE * 0.018, 6);
ctx.fillStyle = '#6366f1';
ctx.fill();
ctx.restore();

// Bubble 1 (front-center, largest) - represents main/unified view
ctx.save();
ctx.shadowColor = 'rgba(30, 27, 75, 0.4)';
ctx.shadowBlur = 32;
ctx.shadowOffsetX = 0;
ctx.shadowOffsetY = 12;
speechBubble(ctx, SIZE * 0.48, SIZE * 0.58, SIZE * 0.52, SIZE * 0.34, 36, 'center', 28);
const bubbleGrad = ctx.createLinearGradient(SIZE * 0.22, SIZE * 0.41, SIZE * 0.74, SIZE * 0.75);
bubbleGrad.addColorStop(0, 'rgba(255, 255, 255, 0.97)');
bubbleGrad.addColorStop(1, 'rgba(238, 242, 255, 0.93)');
ctx.fillStyle = bubbleGrad;
ctx.fill();
ctx.restore();

// Content in front bubble - social post layout
ctx.save();
// Avatar
ctx.beginPath();
ctx.arc(SIZE * 0.29, SIZE * 0.48, SIZE * 0.032, 0, Math.PI * 2);
ctx.fillStyle = '#6366f1';
ctx.globalAlpha = 0.5;
ctx.fill();

// Username
ctx.globalAlpha = 0.55;
roundedRect(ctx, SIZE * 0.335, SIZE * 0.465, SIZE * 0.16, SIZE * 0.018, 6);
ctx.fillStyle = '#4338ca';
ctx.fill();

// Handle
ctx.globalAlpha = 0.35;
roundedRect(ctx, SIZE * 0.335, SIZE * 0.49, SIZE * 0.10, SIZE * 0.013, 5);
ctx.fillStyle = '#6366f1';
ctx.fill();

// Post text lines
ctx.globalAlpha = 0.4;
roundedRect(ctx, SIZE * 0.27, SIZE * 0.53, SIZE * 0.40, SIZE * 0.018, 6);
ctx.fillStyle = '#4f46e5';
ctx.fill();
ctx.globalAlpha = 0.35;
roundedRect(ctx, SIZE * 0.27, SIZE * 0.565, SIZE * 0.36, SIZE * 0.018, 6);
ctx.fillStyle = '#4f46e5';
ctx.fill();
ctx.globalAlpha = 0.30;
roundedRect(ctx, SIZE * 0.27, SIZE * 0.60, SIZE * 0.28, SIZE * 0.018, 6);
ctx.fillStyle = '#4f46e5';
ctx.fill();

// Engagement icons row (heart, repost, reply dots)
ctx.globalAlpha = 0.35;
const iconY = SIZE * 0.66;
const iconR = SIZE * 0.014;
// Heart
ctx.beginPath();
ctx.arc(SIZE * 0.32, iconY, iconR, 0, Math.PI * 2);
ctx.fillStyle = '#6366f1';
ctx.fill();
// Repost
ctx.beginPath();
ctx.arc(SIZE * 0.40, iconY, iconR, 0, Math.PI * 2);
ctx.fillStyle = '#6366f1';
ctx.fill();
// Reply
ctx.beginPath();
ctx.arc(SIZE * 0.48, iconY, iconR, 0, Math.PI * 2);
ctx.fillStyle = '#6366f1';
ctx.fill();
// Share
ctx.beginPath();
ctx.arc(SIZE * 0.56, iconY, iconR, 0, Math.PI * 2);
ctx.fillStyle = '#6366f1';
ctx.fill();

ctx.restore();

// --- Three small platform indicator dots at the top ---
ctx.save();
ctx.globalAlpha = 0.85;
const dotY = SIZE * 0.14;
const dotR = SIZE * 0.024;
const dotSpacing = SIZE * 0.08;

// Bluesky blue
ctx.beginPath();
ctx.arc(SIZE * 0.5 - dotSpacing, dotY, dotR, 0, Math.PI * 2);
ctx.fillStyle = '#0085ff';
ctx.fill();

// Mastodon purple
ctx.beginPath();
ctx.arc(SIZE * 0.5, dotY, dotR, 0, Math.PI * 2);
ctx.fillStyle = '#858afa';
ctx.fill();

// Threads dark
ctx.beginPath();
ctx.arc(SIZE * 0.5 + dotSpacing, dotY, dotR, 0, Math.PI * 2);
ctx.fillStyle = '#ffffff';
ctx.fill();

// Connecting line between dots
ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
ctx.lineWidth = 3;
ctx.beginPath();
ctx.moveTo(SIZE * 0.5 - dotSpacing + dotR + 4, dotY);
ctx.lineTo(SIZE * 0.5 - dotR - 4, dotY);
ctx.stroke();
ctx.beginPath();
ctx.moveTo(SIZE * 0.5 + dotR + 4, dotY);
ctx.lineTo(SIZE * 0.5 + dotSpacing - dotR - 4, dotY);
ctx.stroke();
ctx.restore();

// --- Top-edge gloss ---
ctx.save();
roundedRect(ctx, 0, 0, SIZE, SIZE, cornerRadius);
ctx.clip();
const glossGrad = ctx.createLinearGradient(0, 0, 0, SIZE * 0.35);
glossGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
glossGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
ctx.fillStyle = glossGrad;
ctx.fillRect(0, 0, SIZE, SIZE * 0.35);
ctx.restore();

// --- Export at all needed sizes ---
const staticDir = join(process.cwd(), 'static');

function exportSize(size, filename) {
  const outCanvas = createCanvas(size, size);
  const outCtx = outCanvas.getContext('2d');
  outCtx.drawImage(canvas, 0, 0, size, size);
  writeFileSync(join(staticDir, filename), outCanvas.toBuffer('image/png'));
  console.log(`  ${filename} (${size}x${size})`);
}

console.log('Generating icons:');
exportSize(512, 'icon-512.png');
exportSize(192, 'favicon.png');
exportSize(180, 'apple-touch-icon.png');
exportSize(1024, 'icon-1024.png');

// Also generate maskable version (with extra padding for safe zone)
const maskCanvas = createCanvas(1024, 1024);
const maskCtx = maskCanvas.getContext('2d');
// Fill background to cover safe zone
const maskBg = maskCtx.createLinearGradient(0, 0, 1024, 1024);
maskBg.addColorStop(0, '#6366f1');
maskBg.addColorStop(0.5, '#4f46e5');
maskBg.addColorStop(1, '#3730a3');
maskCtx.fillStyle = maskBg;
maskCtx.fillRect(0, 0, 1024, 1024);
// Draw icon scaled down to safe zone (80% centered)
const pad = 1024 * 0.1;
maskCtx.drawImage(canvas, pad, pad, 1024 - pad * 2, 1024 - pad * 2);

function exportMaskable(size, filename) {
  const outCanvas = createCanvas(size, size);
  const outCtx = outCanvas.getContext('2d');
  outCtx.drawImage(maskCanvas, 0, 0, size, size);
  writeFileSync(join(staticDir, filename), outCanvas.toBuffer('image/png'));
  console.log(`  ${filename} (${size}x${size}) [maskable]`);
}

exportMaskable(512, 'icon-512-maskable.png');
exportMaskable(192, 'icon-192-maskable.png');

console.log('Done!');
