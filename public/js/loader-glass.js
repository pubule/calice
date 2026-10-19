// The start-up loader's glass (#app-loader-glass in index.html): it fills
// with wine as warmUp() reports progress (design D1, chosen by the user).
// Drawn on a canvas: the wine first, clipped to the inside of the glass
// (loader-bowl.png), then the logo's lines on top (loader-glass.png, the
// app icon's drawing without the square and without its wine line). The same
// drawing is the canvas's CSS background, so the empty glass shows before
// this script runs.

const W = 378, H = 376; // the two images' size
const BOWL = { x0: 221, x1: 366, bottom: 195, full: 92 }; // wine from the bottom to "full"
const WINE = '#8a2c44', WINE_TOP = '#a23a55';

const load = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

export function startLoaderGlass(canvas) {
  if (!canvas?.getContext) return { set() {}, stop() {} };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(3, devicePixelRatio || 1);
  const scale = (canvas.clientWidth || 104) / W;
  canvas.width = Math.round(W * scale * dpr);
  canvas.height = Math.round(H * scale * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale * dpr, scale * dpr);
  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const octx = off.getContext('2d');

  let target = 0, filled = 0, running = true, images = null;

  function draw(t) {
    const [art, bowl] = images;
    const level = BOWL.bottom - (BOWL.bottom - BOWL.full) * filled;
    octx.globalCompositeOperation = 'source-over';
    octx.clearRect(0, 0, W, H);
    if (filled > 0.005) {
      const amp = still ? 0 : 3.5 * (1 - filled * 0.5);
      octx.beginPath();
      octx.moveTo(BOWL.x0 - 4, H);
      for (let x = BOWL.x0 - 4; x <= BOWL.x1 + 4; x += 3) octx.lineTo(x, level + Math.sin(x * 0.09 + t * 2.2) * amp);
      octx.lineTo(BOWL.x1 + 4, H);
      octx.closePath();
      const g = octx.createLinearGradient(0, level - 6, 0, BOWL.bottom);
      g.addColorStop(0, WINE_TOP);
      g.addColorStop(1, WINE);
      octx.fillStyle = g;
      octx.fill();
      octx.globalCompositeOperation = 'destination-in';
      octx.drawImage(bowl, 0, 0);
    }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(off, 0, 0);
    ctx.drawImage(art, 0, 0);
  }

  function frame(now) {
    if (!running) return;
    filled = still ? target : filled + (target - filled) * 0.12;
    draw(now / 1000);
    requestAnimationFrame(frame);
  }

  Promise.all([load('/loader-glass.png'), load('/loader-bowl.png')])
    .then((imgs) => { images = imgs; requestAnimationFrame(frame); })
    .catch(() => {}); // the CSS background still shows the empty glass

  return {
    set(p) { target = Math.max(target, Math.min(1, p)); },
    stop() { running = false; },
  };
}
