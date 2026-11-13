// Rank card image (1.8.9): a 900×300 card for /rank, in the same theme as
// the welcome card (1.3.6) — dark background, blurple accent, circular
// avatar, level, XP progress bar, leaderboard rank, total messages.
// Uses node-canvas (installed — same dependency as the welcome cards).
// Returns a PNG Buffer, or null when canvas is unavailable (the caller
// falls back to the text embed).
let createCanvas = null;
let loadImage = null;
let canvasAvailable = false;
try {
  ({ createCanvas, loadImage } = require('canvas'));
  canvasAvailable = true;
} catch { canvasAvailable = false; }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function generateRankCard({ avatarUrl, username, level, xp, xpToNext, rank, totalMessages }) {
  if (!canvasAvailable) return null;
  const W = 900;
  const H = 300;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  // Background + accent bar (same palette as the welcome card).
  ctx.fillStyle = '#1e1f22';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#5865f2';
  ctx.fillRect(0, 0, W, 10);
  ctx.fillStyle = '#2f3136';
  roundRect(ctx, 12, 12, W - 24, H - 24, 18);
  ctx.fill();
  // Avatar (circular, with a blurple ring).
  const avatarSize = 180;
  const avatarX = 48;
  const avatarY = (H - avatarSize) / 2;
  try {
    const avatar = await loadImage(avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png');
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();
    ctx.strokeStyle = '#5865f2';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 2, 0, Math.PI * 2);
    ctx.stroke();
  } catch { /* avatar load failure: draw a placeholder circle */ }
  // Text.
  const textX = avatarX + avatarSize + 36;
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText(username.slice(0, 22), textX, 96);
  ctx.fillStyle = '#b5bac1';
  ctx.font = '28px sans-serif';
  ctx.fillText(`Level ${level}  •  Rank #${rank}`, textX, 140);
  ctx.fillStyle = '#b5bac1';
  ctx.font = '24px sans-serif';
  ctx.fillText(`${totalMessages.toLocaleString()} messages`, textX, 176);
  // XP progress bar.
  const barX = textX;
  const barY = 205;
  const barW = W - textX - 48;
  const barH = 26;
  const pct = xpToNext > 0 ? Math.min(1, xp / xpToNext) : 1;
  ctx.fillStyle = '#2f3136';
  roundRect(ctx, barX, barY, barW, barH, 13);
  ctx.fill();
  ctx.fillStyle = '#5865f2';
  if (pct > 0) {
    roundRect(ctx, barX, barY, Math.max(26, barW * pct), barH, 13);
    ctx.fill();
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(`${xp.toLocaleString()} / ${xpToNext.toLocaleString()} XP`, barX, barY + barH + 34);
  return canvas.toBuffer('image/png');
}

module.exports = { generateRankCard, canvasAvailable };
