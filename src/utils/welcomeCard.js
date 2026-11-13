// Custom welcome images (1.3.6): a 900x300 card rendered with node-canvas.
// Canvas is an optional dependency — if it fails to load (missing native
// libs), this module exports null and the caller falls back to a plain
// embed, so joins never break.
let createCanvas;
let loadImage;
let canvasAvailable = false;
try {
  ({ createCanvas, loadImage } = require('canvas'));
  canvasAvailable = true;
} catch {
  canvasAvailable = false;
}

const WIDTH = 900;
const HEIGHT = 300;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function generateWelcomeCard({ username, avatarUrl, serverName, memberCount }) {
  if (!canvasAvailable) return null;
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  // Dark gradient background (bot theme: blurple on near-black).
  const grad = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  grad.addColorStop(0, '#1e1f22');
  grad.addColorStop(0.6, '#2b2d5e');
  grad.addColorStop(1, '#5865f2');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Subtle accent bar.
  ctx.fillStyle = '#57f287';
  ctx.fillRect(0, HEIGHT - 8, WIDTH, 8);

  // Avatar in a circle (falls back to initials if the avatar can't load).
  const avatarSize = 180;
  const avatarX = 60;
  const avatarY = (HEIGHT - avatarSize) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  let drewAvatar = false;
  if (avatarUrl) {
    try {
      const img = await loadImage(avatarUrl);
      ctx.drawImage(img, avatarX, avatarY, avatarSize, avatarSize);
      drewAvatar = true;
    } catch { /* fall through to initials */ }
  }
  if (!drewAvatar) {
    ctx.fillStyle = '#5865f2';
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 80px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((username || '?').slice(0, 2).toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2 + 4);
  }
  ctx.restore();
  // Ring around the avatar.
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 4, 0, Math.PI * 2);
  ctx.strokeStyle = '#57f287';
  ctx.lineWidth = 6;
  ctx.stroke();

  const textX = avatarX + avatarSize + 40;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 52px sans-serif';
  ctx.fillText(`Welcome, ${username}!`, textX, 130, WIDTH - textX - 30);
  ctx.fillStyle = '#d7d7e0';
  ctx.font = '30px sans-serif';
  ctx.fillText(`to ${serverName}`, textX, 180, WIDTH - textX - 30);
  ctx.fillStyle = '#b5bac1';
  ctx.font = '26px sans-serif';
  ctx.fillText(`You are member #${memberCount}`, textX, 225, WIDTH - textX - 30);

  return canvas.toBuffer('image/png');
}

module.exports = { generateWelcomeCard, canvasAvailable, WIDTH, HEIGHT };
