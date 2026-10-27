/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Motor Cinematográfico HD-2D de PIXELVERSE para el prólogo
 * «CUANDO EL MUNDO OLVIDÓ JUGAR» (00:00–02:30 / 150s).
 *
 * - Ilustraciones cinematográficas de alta densidad (1792×1024) con cámara
 *   virtual (paneo, zoom, sacudida) y encuadre cover dentro de un framebuffer
 *   nítido de 480×270 que se escala sin suavizado a la ventana.
 * - Dirección de escena: capítulos 1–8, 16 beats de narración respetados.
 * - Luz dinámica, partículas, interactivos holográficos, glitch slices y
 *   post-proceso (viñeta, scanlines, grano) calculado a bajo costo.
 * - El sprite del héroe, los mini-juegos y la identidad cromática se dibujan
 *   en el mismo framebuffer para que todo pertenezca al mismo universo.
 */

export interface CinematicWorldController {
  resize: (width: number, height: number) => void;
  renderAtTime: (tSec: number, dtSec: number) => void;
  dispose: () => void;
}

const FB_W = 480;
const FB_H = 270;

/* =========================================================================
   FONDOS ILUSTRADOS
   ========================================================================= */

type BackdropKey =
  | 'bedroom'
  | 'arcade'
  | 'city'
  | 'cosmos'
  | 'hall'
  | 'island'
  | 'gate'
  | 'crono'
  | 'glitch'
  | 'emblem';

const BACKDROP_SRC: Record<BackdropKey, string> = {
  bedroom: '/assets/cinematic/bedroom.png',
  arcade: '/assets/cinematic/abandoned-arcade.png',
  city: '/assets/cinematic/dying-city.png',
  cosmos: '/assets/cinematic/cosmic-spark.png',
  hall: '/assets/cinematic/hall-of-eras.png',
  island: '/assets/cinematic/origins-island.png',
  gate: '/assets/cinematic/cavern-gate.png',
  crono: '/assets/cinematic/cronoscopio.png',
  glitch: '/assets/cinematic/glitch-trail.png',
  emblem: '/assets/cinematic/emblem.jpg',
};

interface BackdropSurface {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
}

interface BackdropEntry {
  img: HTMLImageElement;
  surface: BackdropSurface | null;
}

const backdropEntries = new Map<BackdropKey, BackdropEntry>();

function ensureBackdrop(key: BackdropKey): BackdropEntry {
  let entry = backdropEntries.get(key);
  if (!entry) {
    const img = new Image();
    img.decoding = 'async';
    img.src = BACKDROP_SRC[key];
    entry = { img, surface: null };
    backdropEntries.set(key, entry);
  }
  return entry;
}

/** Reduce cada ilustración una sola vez a 1024 px de ancho (2× el framebuffer). */
function getBackdropSurface(key: BackdropKey): BackdropSurface | null {
  const entry = ensureBackdrop(key);
  if (entry.surface) return entry.surface;
  const img = entry.img;
  if (!img.complete || img.naturalWidth === 0) return null;

  const targetW = Math.min(1024, img.naturalWidth);
  const ratio = targetW / img.naturalWidth;
  const w = Math.max(2, Math.round(img.naturalWidth * ratio));
  const h = Math.max(2, Math.round(img.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, w, h);
  entry.surface = { canvas, w, h };
  // Liberamos la imagen original: la superficie reducida es la que se dibuja.
  img.src = '';
  return entry.surface;
}

/* =========================================================================
   UTILIDADES NUMÉRICAS / CÁMARA
   ========================================================================= */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0 || 1));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function cuePulse(t: number, at: number, decay = 3.2): number {
  return t >= at ? Math.exp(-(t - at) * decay) : 0;
}

interface Cam {
  x: number;
  y: number;
  zoom: number;
  shakeX: number;
  shakeY: number;
}

function makeCam(x: number, y: number, zoom: number, shakeX = 0, shakeY = 0): Cam {
  return { x, y, zoom, shakeX, shakeY };
}

interface CoverRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

function coverRect(surface: BackdropSurface, cam: Cam): CoverRect {
  const scale = Math.max(FB_W / surface.w, FB_H / surface.h) * cam.zoom;
  const dw = surface.w * scale;
  const dh = surface.h * scale;
  return {
    dx: FB_W / 2 - (cam.x / FB_W) * dw + cam.shakeX,
    dy: FB_H / 2 - (cam.y / FB_H) * dh + cam.shakeY,
    dw,
    dh,
  };
}

type Projector = (artX: number, artY: number) => { x: number; y: number; s: number };

/** Coordenadas normalizadas sobre la ilustración 1792×1024 original. */
function makeProjector(key: BackdropKey, cam: Cam): Projector | null {
  const surface = getBackdropSurface(key);
  if (!surface) return null;
  const r = coverRect(surface, cam);
  return (artX, artY) => ({
    x: r.dx + (artX / 1792) * r.dw,
    y: r.dy + (artY / 1024) * r.dh,
    s: r.dw / 1792,
  });
}

function drawBackdrop(
  c: CanvasRenderingContext2D,
  key: BackdropKey,
  cam: Cam,
  alpha = 1
): boolean {
  const surface = getBackdropSurface(key);
  if (!surface) return false;
  const r = coverRect(surface, cam);
  c.save();
  c.globalAlpha = alpha;
  c.imageSmoothingEnabled = true;
  c.drawImage(surface.canvas, r.dx, r.dy, r.dw, r.dh);
  c.restore();
  return true;
}

function drawBandedSky(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  stops: string[]
): void {
  const bandH = Math.ceil(h / stops.length);
  for (let i = 0; i < stops.length; i++) {
    const by = y + i * bandH;
    const bh = Math.min(bandH, y + h - by);
    if (bh <= 0) break;
    c.fillStyle = stops[i];
    c.fillRect(x, by, w, bh);
  }
}

/** Fallback elegante mientras llega la ilustración (nunca deja la pantalla vacía). */
function drawFallback(c: CanvasRenderingContext2D, key: BackdropKey): void {
  const palettes: Record<BackdropKey, string[]> = {
    bedroom: ['#03050c', '#060a17', '#091022', '#0c152c', '#080d1a'],
    arcade: ['#04050f', '#080b1c', '#0b1226', '#070a18'],
    city: ['#06051a', '#0b0824', '#140b2e', '#0a0618'],
    cosmos: ['#03030d', '#08071f', '#12082e', '#070516'],
    hall: ['#03050f', '#05102a', '#081a38', '#040a1d'],
    island: ['#20183a', '#3a2c58', '#5c4a74', '#141028'],
    gate: ['#040312', '#0a0826', '#110c34', '#05040f'],
    crono: ['#07060f', '#1a1408', '#0e1024', '#06050c'],
    glitch: ['#05020f', '#0d0522', '#16082e', '#060212'],
    emblem: ['#010206', '#050514', '#0a0a20', '#020208'],
  };
  drawBandedSky(c, 0, 0, FB_W, FB_H, palettes[key]);
  drawGlow(c, FB_W / 2, FB_H / 2, 110, '#1e3a8a', 0.18);
}

/* =========================================================================
   LUZ, PARTÍCULAS Y TIPOGRAFÍA PIXEL
   ========================================================================= */

function drawGlow(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  alpha: number
): void {
  if (alpha <= 0.012 || radius < 1) return;
  c.save();
  c.globalCompositeOperation = 'lighter';
  for (let i = 3; i >= 1; i--) {
    const r = Math.round((radius * i) / 3);
    c.globalAlpha = (alpha / 3) * (1.35 - (i / 3) * 0.45);
    c.fillStyle = color;
    c.beginPath();
    c.arc(Math.round(cx), Math.round(cy), r, 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
}

function drawRing(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  color: string,
  alpha: number,
  width = 1
): void {
  if (alpha <= 0.01 || radius < 1) return;
  c.save();
  c.globalAlpha = alpha;
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.arc(Math.round(cx), Math.round(cy), radius, 0, Math.PI * 2);
  c.stroke();
  c.restore();
}

function drawShard(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha: number
): void {
  if (alpha <= 0.01) return;
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(Math.round(x), Math.round(y - size));
  c.lineTo(Math.round(x + size * 0.62), Math.round(y));
  c.lineTo(Math.round(x), Math.round(y + size));
  c.lineTo(Math.round(x - size * 0.62), Math.round(y));
  c.closePath();
  c.fill();
  c.globalAlpha = alpha * 0.85;
  c.fillStyle = '#ffffff';
  c.fillRect(Math.round(x), Math.round(y - 1), 1, 2);
  c.restore();
}

function drawMotes(
  c: CanvasRenderingContext2D,
  t: number,
  x: number,
  y: number,
  w: number,
  h: number,
  count: number,
  color: string,
  alpha = 0.35,
  drift = 5
): void {
  c.save();
  c.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const px = Math.round(x + hash(i * 3.17) * w + Math.sin(t * 0.24 + i * 1.7) * drift);
    const py = Math.round(
      y + ((hash(i * 7.31) * h + t * (1.4 + hash(i) * 2.2)) % h)
    );
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * 0.9 + i * 0.83));
    c.globalAlpha = alpha * tw;
    c.fillRect(px, py, 1, 1);
  }
  c.restore();
}

function drawReflectionStreak(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number
): void {
  if (alpha <= 0.01) return;
  c.save();
  for (let i = 0; i < 5; i++) {
    c.fillStyle = color;
    const lw = Math.max(1, Math.round(w * (1 - i * 0.16)));
    c.globalAlpha = alpha * (1 - i * 0.18);
    c.fillRect(Math.round(x - lw / 2), Math.round(y + i * (h / 5)), lw, 1);
  }
  c.restore();
}

const PIXEL_FONT: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  J: ['001', '001', '001', '101', '010'],
  K: ['101', '101', '110', '101', '101'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['101', '111', '111', '111', '101'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  Q: ['010', '101', '101', '111', '011'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  X: ['101', '101', '010', '101', '101'],
  Y: ['101', '101', '010', '010', '010'],
  Z: ['111', '001', '010', '100', '111'],
  ':': ['000', '010', '000', '010', '000'],
  '-': ['000', '000', '111', '000', '000'],
  '.': ['000', '000', '000', '000', '010'],
  '/': ['001', '001', '010', '100', '100'],
  ' ': ['000', '000', '000', '000', '000'],
};

function drawPixelText(
  c: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: string,
  alpha = 1,
  align: 'left' | 'center' | 'right' = 'left'
): void {
  const content = text.toUpperCase();
  const glyphW = 3 * scale;
  const gap = scale;
  const totalW = content.length * (glyphW + gap) - gap;
  let sx = align === 'center' ? x - totalW / 2 : align === 'right' ? x - totalW : x;
  sx = Math.round(sx);
  const sy = Math.round(y);
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = color;
  for (const ch of content) {
    const glyph = PIXEL_FONT[ch] ?? PIXEL_FONT[' '];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        if (glyph[row][col] === '1') {
          c.fillRect(sx + col * scale, sy + row * scale, scale, scale);
        }
      }
    }
    sx += glyphW + gap;
  }
  c.restore();
}

/* =========================================================================
   HÉROE DE PÍXEL (PIXEL) — SILUETA, BUFANDA Y RIM-LIGHT
   ========================================================================= */

interface HeroOptions {
  backView?: boolean;
  running?: boolean;
  auraStrength?: number;
  shadow?: boolean;
}

function drawHero(
  c: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  scale: number,
  t: number,
  opts: HeroOptions = {}
): void {
  const s = Math.max(1, Math.round(scale));
  const running = !!opts.running;
  const bob = running
    ? -Math.round(Math.abs(Math.sin(t * 13)) * 2)
    : Math.round(Math.sin(t * 2.4) * 1.2);
  const aura = opts.auraStrength ?? 0;
  const blink = !opts.backView && Math.sin(t * 1.9 + 1.3) > 0.945;

  if (opts.shadow) {
    c.save();
    c.globalAlpha = 0.42;
    c.fillStyle = '#010208';
    c.beginPath();
    c.ellipse(
      Math.round(cx),
      Math.round(cy + 1),
      Math.round(8 * s),
      Math.max(1, Math.round(2.2 * s)),
      0,
      0,
      Math.PI * 2
    );
    c.fill();
    c.restore();
  }

  if (aura > 0) {
    drawGlow(c, cx, cy - 9 * s + bob, 14 * s, '#00f3ff', aura * 0.32);
    drawGlow(c, cx, cy - 9 * s + bob, 7 * s, '#fde047', aura * 0.2);
  }

  c.save();
  c.translate(Math.round(cx), Math.round(cy + bob));
  c.scale(s, s);

  const out = '#04060f';
  const hairDark = '#1a1026';
  const hairMid = '#2f2450';
  const hairHi = '#67e8f9';
  const skin = '#ffd7b8';
  const skinShade = '#d99b78';
  const suitDark = '#0b4f6c';
  const suitMid = '#0e7490';
  const suitBright = '#22d3ee';
  const scarf = '#fbbf24';
  const scarfShade = '#d97706';

  const stride = running ? Math.round(Math.sin(t * 13) * 3) : 0;

  // Bufanda en dos segmentos ondeando
  const wave = Math.sin(t * 6.4);
  c.fillStyle = out;
  c.fillRect(-13, -13 + Math.round(wave * 1.5), 8, 4);
  c.fillRect(-16, -11 - Math.round(wave), 5, 3);
  c.fillStyle = scarfShade;
  c.fillRect(-12, -13 + Math.round(wave * 1.5), 7, 2);
  c.fillStyle = scarf;
  c.fillRect(-10, -13 + Math.round(wave * 1.5), 5, 1);
  c.fillRect(-15, -11 - Math.round(wave), 4, 1);

  // Piernas y botas
  c.fillStyle = out;
  c.fillRect(-5 + stride, -4, 4, 6);
  c.fillRect(1 - stride, -4, 4, 6);
  c.fillStyle = '#1e293b';
  c.fillRect(-4 + stride, -3, 2, 4);
  c.fillRect(2 - stride, -3, 2, 4);
  c.fillStyle = suitBright;
  c.fillRect(-4 + stride, 0, 2, 1);
  c.fillRect(2 - stride, 0, 2, 1);

  // Torso
  c.fillStyle = out;
  c.fillRect(-6, -13, 12, 10);
  c.fillStyle = suitDark;
  c.fillRect(-5, -12, 10, 8);
  c.fillStyle = suitMid;
  c.fillRect(-4, -11, 3, 6);
  c.fillStyle = suitBright;
  c.fillRect(-2, -10, 4, 3);
  c.fillStyle = scarf;
  c.fillRect(-5, -13, 10, 2);
  c.fillRect(-5, -6, 10, 1);
  // Rim-light derecho
  c.fillStyle = 'rgba(103,232,249,0.85)';
  c.fillRect(4, -12, 1, 7);

  // Brazos
  c.fillStyle = out;
  c.fillRect(-8, -12 - stride * 0.5, 3, 6);
  c.fillRect(5, -12 + stride * 0.5, 3, 6);
  c.fillStyle = skin;
  c.fillRect(-7, -8 - stride * 0.5, 1, 2);
  c.fillRect(6, -8 + stride * 0.5, 1, 2);

  // Cabeza
  c.fillStyle = out;
  c.fillRect(-7, -24, 14, 12);
  if (opts.backView) {
    c.fillStyle = hairDark;
    c.fillRect(-6, -23, 12, 10);
    c.fillStyle = hairMid;
    c.fillRect(-5, -22, 9, 7);
    c.fillStyle = hairHi;
    c.fillRect(4, -22, 2, 5);
    c.fillStyle = 'rgba(251,191,36,0.9)';
    c.fillRect(-6, -14, 12, 1);
  } else {
    c.fillStyle = skinShade;
    c.fillRect(-5, -19, 10, 6);
    c.fillStyle = skin;
    c.fillRect(-4, -19, 8, 5);
    c.fillStyle = hairDark;
    c.fillRect(-6, -23, 12, 5);
    c.fillRect(-6, -19, 2, 4);
    c.fillRect(4, -19, 2, 4);
    c.fillStyle = hairMid;
    c.fillRect(-5, -22, 8, 3);
    c.fillStyle = hairHi;
    c.fillRect(-5, -23, 4, 1);
    if (blink) {
      c.fillStyle = '#0b1220';
      c.fillRect(-3, -16, 2, 1);
      c.fillRect(1, -16, 2, 1);
    } else {
      c.fillStyle = out;
      c.fillRect(-3, -17, 2, 3);
      c.fillRect(1, -17, 2, 3);
      c.fillStyle = '#00f3ff';
      c.fillRect(-3, -16, 2, 2);
      c.fillRect(1, -16, 2, 2);
      c.fillStyle = '#ffffff';
      c.fillRect(-3, -17, 1, 1);
      c.fillRect(1, -17, 1, 1);
    }
  }

  c.restore();
}

/* =========================================================================
   INTERACTIVOS HOLOGRÁFICOS
   ========================================================================= */

interface HoloRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function rectFromArt(p: Projector, x0: number, y0: number, x1: number, y1: number): HoloRect {
  const a = p(x0, y0);
  const b = p(x1, y1);
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

function holoFrame(
  c: CanvasRenderingContext2D,
  r: HoloRect,
  color: string,
  alpha: number
): void {
  if (r.w <= 4 || r.h <= 4) return;
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  const w = Math.round(r.w);
  const h = Math.round(r.h);
  c.save();
  c.globalAlpha = alpha;
  c.fillStyle = 'rgba(2,8,18,0.52)';
  c.fillRect(x, y, w, h);
  c.fillStyle = 'rgba(8,28,44,0.35)';
  c.fillRect(x + 1, y + 1, w - 2, Math.round(h * 0.32));
  c.strokeStyle = color;
  c.lineWidth = 1;
  c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  c.globalAlpha = alpha * 0.2;
  c.fillStyle = '#000000';
  for (let yy = y + 2; yy < y + h - 1; yy += 3) c.fillRect(x + 1, yy, w - 2, 1);
  c.globalAlpha = alpha;
  c.fillStyle = color;
  c.fillRect(x - 1, y - 1, 3, 2);
  c.fillRect(x + w - 2, y - 1, 3, 2);
  c.fillRect(x - 1, y + h - 1, 3, 2);
  c.fillRect(x + w - 2, y + h - 1, 3, 2);
  c.restore();
}

function drawPongHolo(c: CanvasRenderingContext2D, r: HoloRect, t: number, color: string): void {
  const { x, y, w, h } = r;
  if (w < 8 || h < 8) return;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  const padH = Math.max(3, h * 0.26);
  const leftY = y + h * 0.5 + Math.sin(t * 0.9) * h * 0.2 - padH / 2;
  const rightY = y + h * 0.5 + Math.sin(t * 0.72 + 2.1) * h * 0.18 - padH / 2;
  c.fillStyle = color;
  c.globalAlpha = 0.55;
  for (let ny = y + 9; ny < y + h - 8; ny += 4) {
    c.fillRect(Math.round(x + w * 0.5), Math.round(ny), 1, 2);
  }
  c.globalAlpha = 0.95;
  c.fillRect(Math.round(x + 3), Math.round(leftY), 2, Math.round(padH));
  c.fillRect(Math.round(x + w - 5), Math.round(rightY), 2, Math.round(padH));
  const bx = x + w * 0.5 + Math.sin(t * 1.3) * w * 0.32;
  const by = y + h * 0.5 + Math.cos(t * 1.7) * h * 0.3;
  c.fillStyle = '#f8fafc';
  c.fillRect(Math.round(bx) - 1, Math.round(by) - 1, 2, 2);
  drawPixelText(c, '3 5', x + w / 2, y + 2, 1, '#fbbf24', 0.9, 'center');
  drawPixelText(c, '1972', x + w / 2, y + h - 7, 1, color, 0.85, 'center');
  c.restore();
}

function drawBreakoutHolo(c: CanvasRenderingContext2D, r: HoloRect, t: number, color: string): void {
  const { x, y, w, h } = r;
  if (w < 8 || h < 8) return;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  const cols = 6;
  const rows = 3;
  const bw = Math.max(2, (w - 6) / cols);
  const bh = 2;
  const shake = cuePulse(t, 76.4, 5) * 2;
  for (let ry = 0; ry < rows; ry++) {
    for (let cx = 0; cx < cols; cx++) {
      const idx = ry * cols + cx;
      const alive = hash(idx * 4.7 + 1.3) > 0.22 && !(idx % 7 === 0 && t > 78);
      if (!alive) continue;
      c.fillStyle = idx % 3 === 0 ? '#fbbf24' : idx % 3 === 1 ? color : '#f472b6';
      c.globalAlpha = 0.9;
      c.fillRect(
        Math.round(x + 3 + cx * bw + shake * (idx % 2 === 0 ? 0.4 : -0.4)),
        Math.round(y + 9 + ry * (bh + 1)),
        Math.max(1, Math.floor(bw) - 1),
        bh
      );
    }
  }
  c.globalAlpha = 1;
  c.fillStyle = color;
  const paddleX = x + w * 0.5 + Math.sin(t * 1.1) * w * 0.3;
  c.fillRect(Math.round(paddleX - 5), Math.round(y + h - 10), 10, 2);
  const bx = x + w * 0.5 + Math.sin(t * 1.35) * w * 0.34;
  const by = y + h * 0.62 + Math.cos(t * 1.9) * h * 0.18;
  c.fillStyle = '#f8fafc';
  c.fillRect(Math.round(bx), Math.round(by), 1, 1);
  drawPixelText(c, '1976', x + w / 2, y + h - 7, 1, color, 0.8, 'center');
  c.restore();
}

function drawInvadersHolo(c: CanvasRenderingContext2D, r: HoloRect, t: number, color: string): void {
  const { x, y, w, h } = r;
  if (w < 8 || h < 8) return;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  const step = Math.floor((t * 1.4) % 2) * 2;
  c.fillStyle = color;
  c.globalAlpha = 0.92;
  for (let ry = 0; ry < 2; ry++) {
    for (let cx = 0; cx < 5; cx++) {
      if (hash(cx * 3.1 + ry * 7.7) > 0.82 && t > 77.5) continue;
      const ex = Math.round(x + 4 + cx * ((w - 8) / 5) + step * (cx % 2 === 0 ? 1 : -1));
      const ey = Math.round(y + 9 + ry * 9);
      c.fillRect(ex, ey, 4, 1);
      c.fillRect(ex + 1, ey + 1, 2, 1);
      c.fillRect(ex, ey + 2, 1, 1);
      c.fillRect(ex + 3, ey + 2, 1, 1);
    }
  }
  const shipX = x + w * 0.5 + Math.sin(t * 1.6) * w * 0.26;
  c.globalAlpha = 1;
  c.fillStyle = '#67e8f9';
  c.fillRect(Math.round(shipX) - 2, Math.round(y + h - 12), 5, 2);
  c.fillRect(Math.round(shipX), Math.round(y + h - 14), 1, 2);
  const by = y + h - 18 - ((t * 26) % (h - 24));
  c.fillStyle = '#fde047';
  c.fillRect(Math.round(shipX), Math.round(by), 1, 3);
  drawPixelText(c, '1978', x + w / 2, y + h - 7, 1, color, 0.8, 'center');
  c.restore();
}

function drawAsteroidsHolo(c: CanvasRenderingContext2D, r: HoloRect, t: number, color: string): void {
  const { x, y, w, h } = r;
  if (w < 8 || h < 8) return;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  const shipX = x + w * 0.5 + Math.sin(t * 0.8) * w * 0.2;
  const shipY = y + h * 0.58 + Math.cos(t * 1.05) * h * 0.16;
  c.strokeStyle = '#67e8f9';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(shipX, shipY - 4);
  c.lineTo(shipX + 3, shipY + 3);
  c.lineTo(shipX - 3, shipY + 3);
  c.closePath();
  c.stroke();
  for (let i = 0; i < 4; i++) {
    const rx = x + 6 + hash(i * 5.3 + 2) * (w - 12);
    const ry =
      y + 9 + ((hash(i * 2.9 + 5) * (h - 20) + t * (2 + i)) % Math.max(4, h - 20));
    c.fillStyle = i % 2 === 0 ? '#c084fc' : '#a5b4fc';
    c.fillRect(Math.round(rx), Math.round(ry), 2, 2);
    c.fillRect(Math.round(rx + 2), Math.round(ry - 1), 1, 1);
  }
  c.fillStyle = '#fde047';
  c.fillRect(Math.round(shipX), Math.round(shipY - 12), 1, 6);
  drawPixelText(c, '1979', x + w / 2, y + h - 7, 1, color, 0.8, 'center');
  c.restore();
}

function drawBeamsHolo(c: CanvasRenderingContext2D, r: HoloRect, t: number, color: string): void {
  const { x, y, w, h } = r;
  if (w < 8 || h < 8) return;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.fillStyle = 'rgba(30,2,12,0.28)';
  c.fillRect(x, y, w, h);
  for (let i = 0; i < 4; i++) {
    const bx = x + 5 + (i * (w - 10)) / 3 + Math.sin(t * 0.9 + i) * 2;
    c.fillStyle = i % 2 === 0 ? '#ef4444' : '#f97316';
    c.globalAlpha = 0.55 + Math.sin(t * 3 + i) * 0.25;
    c.fillRect(Math.round(bx), y + 6, 1, h - 14);
  }
  c.globalAlpha = 0.8;
  c.fillStyle = '#fecaca';
  c.fillRect(x + 2, Math.round(y + ((t * 18) % (h - 10))), w - 4, 1);
  drawPixelText(c, '1981', x + w / 2, y + h - 7, 1, color, 0.8, 'center');
  c.restore();
}

function drawStaticPanel(
  c: CanvasRenderingContext2D,
  r: HoloRect,
  t: number,
  color: string,
  alpha: number
): void {
  const { x, y, w, h } = r;
  c.save();
  c.globalAlpha = alpha;
  const tick = Math.floor(t * 9);
  for (let i = 0; i < 26; i++) {
    const px = x + 2 + hash(i * 3.1 + tick) * (w - 4);
    const py = y + 2 + hash(i * 7.3 + tick * 1.7) * (h - 4);
    c.fillStyle = i % 3 === 0 ? '#ffffff' : color;
    c.fillRect(Math.round(px), Math.round(py), 1, 1);
  }
  c.restore();
}

/* =========================================================================
   EFECTOS DE CORRUPCIÓN DIGITAL
   ========================================================================= */

function drawGlitchSlices(
  c: CanvasRenderingContext2D,
  key: BackdropKey,
  cam: Cam,
  t: number,
  intensity: number
): void {
  if (intensity < 0.04) return;
  const surface = getBackdropSurface(key);
  if (!surface) return;
  const r = coverRect(surface, cam);
  const tick = Math.floor(t * 18);
  const bands = 3 + Math.floor(intensity * 4);
  c.save();
  for (let i = 0; i < bands; i++) {
    const y = Math.floor(hash(i * 3.13 + tick * 0.71) * (FB_H - 8));
    const h = 2 + Math.floor(hash(i * 9.37 + tick * 1.91) * (5 + intensity * 16));
    const shift = Math.round((hash(i * 5.93 + tick * 2.31) - 0.5) * 58 * intensity);
    c.save();
    c.beginPath();
    c.rect(0, y, FB_W, h);
    c.clip();
    c.imageSmoothingEnabled = true;
    c.drawImage(surface.canvas, r.dx + shift, r.dy, r.dw, r.dh);
    c.fillStyle = i % 2 === 0 ? 'rgba(0,243,255,0.15)' : 'rgba(244,63,94,0.13)';
    c.fillRect(0, y, FB_W, h);
    c.fillStyle = 'rgba(235,255,255,0.22)';
    c.fillRect(0, y, FB_W, 1);
    c.restore();
  }
  c.restore();
}

function drawSignalCorruption(
  c: CanvasRenderingContext2D,
  t: number,
  intensity: number
): void {
  if (intensity < 0.05) return;
  const tick = Math.floor(t * 11);
  c.save();
  for (let i = 0; i < 3; i++) {
    const y = Math.round(hash(i * 4.7 + tick) * FB_H);
    const h = 1 + Math.floor(hash(i * 9.1 + tick * 2) * 3);
    c.fillStyle = i % 2 === 0 ? 'rgba(0,243,255,0.08)' : 'rgba(244,63,94,0.07)';
    c.fillRect(0, y, FB_W, h);
  }
  const sweepY = Math.round((t * 74) % FB_H);
  c.fillStyle = 'rgba(140,240,255,0.06)';
  c.fillRect(0, sweepY, FB_W, 2);
  for (let i = 0; i < 9; i++) {
    const bx = hash(i * 3.7 + tick * 1.3) * FB_W;
    const by = hash(i * 8.3 + tick * 0.9) * FB_H;
    c.fillStyle = i % 3 === 0 ? 'rgba(244,63,94,0.16)' : 'rgba(0,243,255,0.14)';
    c.fillRect(Math.round(bx), Math.round(by), 2 + Math.floor(hash(i) * 5), 1);
  }
  c.restore();
}

function drawSpeedLines(
  c: CanvasRenderingContext2D,
  t: number,
  intensity: number
): void {
  if (intensity < 0.08) return;
  c.save();
  for (let i = 0; i < 14; i++) {
    const y = Math.round(hash(i * 3.3) * FB_H);
    const speed = 320 + hash(i * 7.1) * 520;
    const x = FB_W + 10 - ((t * speed + hash(i) * 640) % (FB_W + 80));
    const len = 14 + hash(i * 5.7) * 60;
    c.globalAlpha = 0.05 + hash(i * 2.1) * 0.16 * intensity;
    c.fillStyle = i % 4 === 0 ? '#f0abfc' : '#67e8f9';
    c.fillRect(Math.round(x), y, Math.round(len), 1);
  }
  c.restore();
}

function drawEyeCutIn(c: CanvasRenderingContext2D, t: number): { alpha: number } {
  const enter = smoothstep(138.35, 139.15, t);
  const exit = 1 - smoothstep(140.85, 141.5, t);
  const alpha = enter * exit;
  if (alpha <= 0.01) return { alpha: 0 };
  const lookX = Math.sin(t * 0.8) * 4;
  const lookY = 2 + Math.sin(t * 1.3) * 1.5;

  c.save();
  c.globalAlpha = alpha;

  // Silueta de un rostro/máscara emergiendo de la corrupción
  c.fillStyle = '#010207';
  c.beginPath();
  c.moveTo(FB_W / 2 - 96, -12);
  c.lineTo(FB_W / 2 + 96, -12);
  c.lineTo(FB_W / 2 + 82, 58);
  c.quadraticCurveTo(FB_W / 2 + 58, 126, FB_W / 2, 146);
  c.quadraticCurveTo(FB_W / 2 - 58, 126, FB_W / 2 - 82, 58);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(168,85,247,0.4)';
  c.lineWidth = 1;
  c.stroke();

  // Grietas
  c.strokeStyle = 'rgba(103,232,249,0.28)';
  c.beginPath();
  c.moveTo(FB_W / 2 - 70, 18);
  c.lineTo(FB_W / 2 - 30, 44);
  c.lineTo(FB_W / 2 - 52, 76);
  c.moveTo(FB_W / 2 + 62, 8);
  c.lineTo(FB_W / 2 + 28, 34);
  c.lineTo(FB_W / 2 + 48, 64);
  c.stroke();

  const eyeY = 66;
  [FB_W / 2 - 34, FB_W / 2 + 34].forEach((ex, idx) => {
    drawGlow(c, ex, eyeY, 17, '#00f3ff', 0.42);
    c.fillStyle = '#02060c';
    c.beginPath();
    c.ellipse(ex, eyeY, 17, 9, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = idx === 0 ? '#22d3ee' : '#67e8f9';
    c.beginPath();
    c.ellipse(ex + lookX, eyeY + lookY, 10, 6, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#e0feff';
    c.beginPath();
    c.ellipse(ex + lookX, eyeY + lookY, 6, 3.4, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#04121c';
    c.beginPath();
    c.ellipse(ex + lookX, eyeY + lookY, 2.6, 4.2, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#ffffff';
    c.fillRect(Math.round(ex + lookX - 4), Math.round(eyeY + lookY - 3), 2, 2);
    c.fillStyle = '#010207';
    c.beginPath();
    c.ellipse(ex, eyeY - 7, 18, 5, 0, Math.PI, Math.PI * 2);
    c.fill();
  });

  const sy = 34 + ((t * 52) % 72);
  c.fillStyle = 'rgba(0,243,255,0.14)';
  c.fillRect(FB_W / 2 - 92, Math.round(sy), 184, 2);
  c.restore();
  return { alpha };
}

/* =========================================================================
   ESCENAS
   ========================================================================= */

const SCENE_CUTS = [18, 42, 65, 90, 112, 121.5, 132, 144];

function cutEffects(t: number): { flash: number; dip: number } {
  let flash = 0;
  let dip = 0;
  for (const cut of SCENE_CUTS) {
    const d = Math.abs(t - cut);
    if (d < 0.5) dip = Math.max(dip, 1 - d / 0.5);
    if (t >= cut - 0.16 && t <= cut + 0.22) {
      flash = Math.max(flash, 1 - Math.abs(t - (cut + 0.02)) / 0.19);
    }
  }
  return { flash: clamp01(flash), dip: clamp01(dip) };
}

/* -------------------------------------------------------------------------
   CAP. 1 · 00:00–00:18 — LA ÚLTIMA HABITACIÓN
   ------------------------------------------------------------------------- */
function renderScene1(c: CanvasRenderingContext2D, t: number): void {
  const push = smoothstep(0, 18, t);
  const pressShake =
    cuePulse(t, 2.35, 6) * 0.5 +
    cuePulse(t, 12.05, 6) * 1.1 +
    cuePulse(t, 15.12, 7) * 2.2;
  const cam = makeCam(
    lerp(252, 279, push),
    lerp(132, 119, push),
    1.005 + 0.078 * push,
    Math.sin(t * 62) * pressShake,
    Math.cos(t * 54) * pressShake * 0.8
  );

  if (!drawBackdrop(c, 'bedroom', cam, 1)) {
    drawFallback(c, 'bedroom');
  }
  const p = makeProjector('bedroom', cam);

  if (p) {
    const moon = p(295, 84);
    drawGlow(c, moon.x, moon.y, 24, '#bfdbfe', 0.18 + Math.sin(t * 0.8) * 0.035);
    drawMotes(c, t, 40, 42, 300, 140, 30, '#cfe9ff', 0.34, 7);
    drawMotes(c, t, 40, 42, 300, 140, 12, '#fde68a', 0.16, 5);

    // Scanlines del tubo CRT ancladas a la pantalla ilustrada
    const a = p(858, 288);
    const b = p(1298, 632);
    if (b.x > a.x + 4 && b.y > a.y + 4) {
      c.save();
      c.beginPath();
      c.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      c.clip();
      c.fillStyle = 'rgba(0,0,0,0.13)';
      for (let yy = Math.ceil(a.y); yy < b.y; yy += 2) {
        c.fillRect(a.x, yy, b.x - a.x, 1);
      }
      const bandY = a.y + ((t * 0.24) % 1) * (b.y - a.y);
      c.fillStyle = 'rgba(125,211,252,0.055)';
      c.fillRect(a.x, bandY, b.x - a.x, 3);
      c.restore();
    }

    // El último píxel
    const dot = p(1090, 470);
    const dying = smoothstep(13.8, 16.1, t);
    if (t < 16.2) {
      if (dying > 0.18) {
        c.save();
        c.globalAlpha = Math.min(1, dying * 1.4);
        c.fillStyle = 'rgba(3,6,13,0.92)';
        c.beginPath();
        c.arc(dot.x, dot.y, 4.5, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
      const jitterX = t > 11.4 ? Math.round(Math.sin(t * 41) * (0.6 + dying * 2.4)) : 0;
      const jitterY = t > 11.4 ? Math.round(Math.cos(t * 33) * dying * 1.6) : 0;
      const px = Math.round(dot.x + jitterX);
      const py = Math.round(dot.y + jitterY);
      const glowA = (1 - dying) * (0.4 + Math.sin(t * 7) * 0.1) + 0.05;
      drawGlow(c, px, py, 11 + 9 * (1 - dying), '#67e8f9', glowA);

      if (t >= 15.08) {
        const collapse = 1 - smoothstep(15.08, 16.05, t);
        const lw = Math.max(0, Math.round(38 * collapse));
        if (lw > 0) {
          c.fillStyle = '#e0f2fe';
          c.fillRect(px - Math.floor(lw / 2), py, lw, 2);
          c.fillStyle = '#ffffff';
          c.fillRect(px - Math.floor(lw / 4), py, Math.max(1, Math.floor(lw / 2)), 1);
        }
      } else {
        const size = Math.max(2, Math.round(4.5 * (1 - dying * 0.55)));
        c.fillStyle = '#bae6fd';
        c.fillRect(px - 1, py - 1, size + 2, size + 2);
        c.fillStyle = '#ffffff';
        c.fillRect(px, py, size, size);
      }

      const shock = t >= 15.25 ? t - 15.25 : -1;
      if (shock >= 0 && shock < 1.4) {
        drawRing(c, dot.x, dot.y, 4 + shock * 70, '#7dd3fc', 0.35 * (1 - shock / 1.4));
      }
    }

    // El botón del joystick pulsa con el clic de la partitura
    const button = p(205, 746);
    const buttonPulse = Math.max(cuePulse(t, 2.35, 7), cuePulse(t, 12.05, 7));
    if (buttonPulse > 0.02) {
      drawGlow(c, button.x, button.y, 5, '#fbbf24', buttonPulse * 0.5);
      c.fillStyle = 'rgba(253,224,71,0.9)';
      c.fillRect(Math.round(button.x), Math.round(button.y), 1, 1);
    }

    if (t > 6.6 && t < 13.8) {
      const awake = smoothstep(6.6, 9.5, t) * (1 - smoothstep(13.8, 15.0, t));
      drawGlow(c, dot.x, dot.y, 20, '#0ea5e9', awake * 0.1);
    }
  }

  if (t > 16.7) {
    c.fillStyle = `rgba(2,3,9,${smoothstep(16.7, 18, t) * 0.55})`;
    c.fillRect(0, 0, FB_W, FB_H);
  }
}

/* -------------------------------------------------------------------------
   CAP. 2 · 00:18–00:42 — EL MUNDO QUE OLVIDÓ JUGAR
   ------------------------------------------------------------------------- */
const ARCADE_SCREENS = [
  { x: 62, y: 492, color: '#38bdf8' },
  { x: 235, y: 478, color: '#fbbf24' },
  { x: 388, y: 464, color: '#f472b6' },
  { x: 505, y: 452, color: '#67e8f9' },
  { x: 602, y: 442, color: '#a3e635' },
  { x: 1302, y: 445, color: '#fbbf24' },
  { x: 1418, y: 458, color: '#38bdf8' },
  { x: 1540, y: 474, color: '#f472b6' },
  { x: 1656, y: 490, color: '#67e8f9' },
];

const CITY_WINDOWS = [
  { x: 382, y: 190, color: '#fbbf24', threshold: 0.12, speed: 7.3 },
  { x: 380, y: 206, color: '#fcd34d', threshold: 0.2, speed: 5.1 },
  { x: 432, y: 232, color: '#fbbf24', threshold: 0.28, speed: 6.4 },
  { x: 430, y: 258, color: '#f59e0b', threshold: 0.35, speed: 4.2 },
  { x: 754, y: 332, color: '#fbbf24', threshold: 0.42, speed: 6.9 },
  { x: 782, y: 474, color: '#fcd34d', threshold: 0.48, speed: 5.5 },
  { x: 1158, y: 430, color: '#fbbf24', threshold: 0.55, speed: 7.7 },
  { x: 1204, y: 472, color: '#fcd34d', threshold: 0.61, speed: 4.8 },
  { x: 1288, y: 456, color: '#fbbf24', threshold: 0.67, speed: 6.2 },
  { x: 1386, y: 300, color: '#fcd34d', threshold: 0.72, speed: 5.9 },
  { x: 80, y: 532, color: '#fbbf24', threshold: 0.78, speed: 7.1 },
  { x: 1652, y: 684, color: '#fcd34d', threshold: 0.83, speed: 5.4 },
  { x: 1712, y: 650, color: '#fbbf24', threshold: 0.88, speed: 6.8 },
  { x: 1290, y: 620, color: '#fcd34d', threshold: 0.93, speed: 4.9 },
  { x: 1660, y: 300, color: '#fbbf24', threshold: 0.97, speed: 6.1 },
];

function renderArcadeHall(c: CanvasRenderingContext2D, t: number): void {
  const k = smoothstep(18, 27.5, t);
  const cam = makeCam(lerp(236, 247, k), lerp(136, 130, k), 1.02 + 0.07 * k);
  if (!drawBackdrop(c, 'arcade', cam, 1)) drawFallback(c, 'arcade');
  const p = makeProjector('arcade', cam);
  if (!p) return;

  const moon = p(945, 88);
  drawGlow(c, moon.x, moon.y, 16, '#dbeafe', 0.3);
  drawMotes(c, t, 180, 30, 130, 150, 20, '#cfe9ff', 0.28, 4);
  drawMotes(c, t, 60, 150, 360, 90, 14, '#94a3b8', 0.16, 6);

  ARCADE_SCREENS.forEach((screen, i) => {
    const offAt = 19.25 + i * 0.86;
    const pos = p(screen.x, screen.y);
    if (t < offAt) {
      const flicker = 0.6 + 0.4 * Math.abs(Math.sin(t * (5 + i) + i));
      drawGlow(c, pos.x, pos.y, 8, screen.color, 0.26 * flicker);
      c.fillStyle = screen.color;
      c.globalAlpha = 0.85 * flicker;
      const jitter = Math.round(Math.sin(t * 9 + i * 3) * 1.5);
      c.fillRect(Math.round(pos.x + jitter), Math.round(pos.y), 2, 1);
      c.globalAlpha = 1;
    } else if (t < offAt + 0.5) {
      const spark = 1 - (t - offAt) / 0.5;
      for (let s = 0; s < 5; s++) {
        const a = (s / 5) * Math.PI * 2 + i;
        c.fillStyle = s % 2 === 0 ? '#e0f2fe' : screen.color;
        c.fillRect(
          Math.round(pos.x + Math.cos(a) * (3 + (1 - spark) * 7)),
          Math.round(pos.y + Math.sin(a) * (2 + (1 - spark) * 5)),
          1,
          1
        );
      }
      drawGlow(c, pos.x, pos.y, 6, screen.color, spark * 0.2);
    }
  });

  c.save();
  c.globalAlpha = 0.045;
  c.fillStyle = '#93c5fd';
  c.fillRect(0, 208 + Math.sin(t * 0.5) * 3, FB_W, 10);
  c.globalAlpha = 0.03;
  c.fillRect(0, 228 + Math.cos(t * 0.4) * 3, FB_W, 12);
  c.restore();

  const fade = smoothstep(26.2, 27.5, t);
  if (fade > 0) {
    c.fillStyle = `rgba(1,2,7,${fade * 0.75})`;
    c.fillRect(0, 0, FB_W, FB_H);
  }
}

function renderCity(c: CanvasRenderingContext2D, t: number): void {
  const k = smoothstep(27.5, 38.6, t);
  const cam = makeCam(lerp(238, 259, k), lerp(137, 131, k), 1.03 + 0.06 * k);
  if (!drawBackdrop(c, 'city', cam, 1)) drawFallback(c, 'city');
  const p = makeProjector('city', cam);
  const dark = smoothstep(28.6, 38.35, t);

  if (p) {
    CITY_WINDOWS.forEach((w) => {
      if (dark >= w.threshold) return;
      const pos = p(w.x, w.y);
      const flicker = 0.55 + 0.45 * Math.sin(t * w.speed + w.x);
      drawGlow(c, pos.x, pos.y, 4, w.color, 0.3 * flicker);
      c.globalAlpha = 0.9;
      c.fillStyle = w.color;
      c.fillRect(Math.round(pos.x), Math.round(pos.y), 1, 1);
      c.globalAlpha = 1;
    });

    if (t > 33.2 && t < 34.1) {
      const u = (t - 33.2) / 0.9;
      const sx = 340 - u * 70;
      const sy = 34 + u * 18;
      c.save();
      c.globalAlpha = 0.6 * (1 - u);
      c.strokeStyle = '#e0f2fe';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(sx, sy);
      c.lineTo(sx + 16, sy - 4);
      c.stroke();
      c.restore();
    }

    drawMotes(c, t, 20, 120, 440, 120, 18, '#c4b5fd', 0.2, 8);
  }

  if (dark > 0) {
    c.fillStyle = `rgba(2,2,9,${dark * 0.86})`;
    c.fillRect(0, 0, FB_W, FB_H);
  }
}

function renderScene2(c: CanvasRenderingContext2D, t: number): void {
  if (t >= 38.6) {
    c.fillStyle = '#010206';
    c.fillRect(0, 0, FB_W, FB_H);
    const residual = 1 - smoothstep(38.6, 39.9, t);
    if (residual > 0.01) {
      drawGlow(c, FB_W / 2, FB_H / 2, 14, '#38bdf8', residual * 0.22);
      c.fillStyle = `rgba(125,211,252,${residual * 0.65})`;
      c.fillRect(FB_W / 2, FB_H / 2, 1, 1);
    }
    return;
  }

  if (t < 27.4) {
    renderArcadeHall(c, t);
  } else if (t < 28.2) {
    renderArcadeHall(c, t);
    renderCity(c, t);
    const seam = 1 - Math.abs(t - 27.8) / 0.4;
    if (seam > 0) {
      c.fillStyle = `rgba(2,4,12,${seam * 0.45})`;
      c.fillRect(0, 0, FB_W, FB_H);
    }
  } else {
    renderCity(c, t);
  }
}

/* -------------------------------------------------------------------------
   CAP. 3 · 00:42–01:05 — EL DESPERTAR DE PIXEL
   ------------------------------------------------------------------------- */
function renderScene3(c: CanvasRenderingContext2D, t: number): void {
  const reveal = smoothstep(42, 65, t);
  const cam = makeCam(
    238 + Math.sin((t - 42) * 0.12) * 4,
    lerp(108, 120, reveal * 0.7),
    lerp(1.145, 1.03, reveal)
  );
  if (!drawBackdrop(c, 'cosmos', cam, 1)) drawFallback(c, 'cosmos');
  const p = makeProjector('cosmos', cam);

  const dim = 1 - smoothstep(43.2, 47.8, t);
  if (dim > 0) {
    c.fillStyle = `rgba(1,2,9,${dim * 0.58})`;
    c.fillRect(0, 0, FB_W, FB_H);
  }

  if (p) {
    const spark = p(888, 401);
    const ignite = smoothstep(44.2, 49.2, t);
    const breath = 0.5 + 0.5 * Math.sin(t * 1.6);
    drawGlow(
      c,
      spark.x,
      spark.y,
      30 + 16 * ignite + breath * 4,
      '#67e8f9',
      0.14 + ignite * 0.2
    );
    drawGlow(c, spark.x, spark.y, 10, '#f8fafc', 0.2 + ignite * 0.2);

    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = 0.2 + ignite * 0.25;
    c.strokeStyle = '#a5f3fc';
    c.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.sin(t * 0.2) * 0.1;
      const len = 28 + ignite * 34 + Math.sin(t * 2 + i) * 6;
      c.beginPath();
      c.moveTo(spark.x, spark.y);
      c.lineTo(spark.x + Math.cos(angle) * len, spark.y + Math.sin(angle) * len);
      c.stroke();
    }
    c.restore();

    if (t > 57.2) {
      for (let i = 0; i < 3; i++) {
        const age = (t - 57.2 - i * 0.5) % 4.2;
        if (age < 0) continue;
        const r = 8 + age * 24;
        drawRing(
          c,
          spark.x,
          spark.y,
          r,
          i % 2 === 0 ? '#a5f3fc' : '#fde68a',
          0.3 * (1 - age / 4.2)
        );
      }
    }

    for (let i = 0; i < 18; i++) {
      const start = 46.5 + hash(i * 3.3) * 5.5;
      const u = smoothstep(start, start + 6.2, t);
      if (u <= 0 || u >= 1) continue;
      const angle = hash(i * 7.1) * Math.PI * 2;
      const radius = lerp(210 + hash(i * 5.7) * 120, 4, u);
      const sx = spark.x + Math.cos(angle) * radius;
      const sy = spark.y + Math.sin(angle) * radius * 0.62;
      drawShard(
        c,
        sx,
        sy,
        i % 3 === 0 ? 2.4 : 1.5,
        i % 4 === 0 ? '#fde047' : '#67e8f9',
        Math.sin(u * Math.PI) * 0.9
      );
    }

    drawMotes(c, t, 0, 120, FB_W, 150, 22, '#fde68a', 0.2, 6);
  }

  const form = smoothstep(51.4, 57.6, t);
  if (form > 0.02) {
    const feetY = lerp(198, 189, form);
    const aura = form * (0.55 + cuePulse(t, 58.6, 2) * 0.4);
    c.save();
    c.globalAlpha = form;
    drawGlow(c, 241, feetY - 18, 22, '#22d3ee', form * 0.28);
    drawHero(c, 241, feetY, 3, t, {
      backView: t >= 59.3,
      auraStrength: aura,
      shadow: false,
    });
    c.restore();
    drawReflectionStreak(c, 241, feetY + 2, 26, 14, '#22d3ee', form * 0.06);
  }
}

/* -------------------------------------------------------------------------
   CAP. 4 · 01:05–01:30 — EL SALÓN DE LAS ERAS
   ------------------------------------------------------------------------- */
function renderScene4(c: CanvasRenderingContext2D, t: number): void {
  const k = smoothstep(65, 90, t);
  const cam = makeCam(lerp(233, 242, k), lerp(112, 126, k), lerp(1.02, 1.085, k));
  if (!drawBackdrop(c, 'hall', cam, 1)) drawFallback(c, 'hall');
  const p = makeProjector('hall', cam);

  if (p) {
    const orb = p(897, 56);
    drawGlow(c, orb.x, orb.y, 22, '#67e8f9', 0.24 + Math.sin(t * 1.4) * 0.05);

    const leftRect = rectFromArt(p, 392, 278, 548, 424);
    const centerRect = rectFromArt(p, 778, 264, 1006, 392);
    const rightRect = rectFromArt(p, 1252, 278, 1414, 424);

    const eraA = t < 73.5;
    const eraB = t >= 73.5 && t < 81.5;
    const eraC = t >= 81.5;

    const flashAB = cuePulse(t, 73.5, 4) * 0.3;
    const flashBC = cuePulse(t, 81.5, 4) * 0.3;

    holoFrame(c, leftRect, '#67e8f9', 0.55);
    holoFrame(c, rightRect, '#67e8f9', 0.55);
    holoFrame(c, centerRect, '#a5f3fc', 0.7);

    if (eraA) {
      drawPongHolo(c, centerRect, t, '#67e8f9');
      drawStaticPanel(c, leftRect, t, '#67e8f9', 0.16);
      drawStaticPanel(c, rightRect, t, '#67e8f9', 0.14);
    } else if (eraB) {
      drawBreakoutHolo(c, leftRect, t, '#34d399');
      drawInvadersHolo(c, rightRect, t, '#67e8f9');
      drawStaticPanel(c, centerRect, t, '#a5f3fc', 0.22 + flashAB);
    } else {
      drawAsteroidsHolo(c, leftRect, t, '#c084fc');
      drawBeamsHolo(c, rightRect, t, '#f87171');
      const core = 0.5 + 0.5 * Math.sin(t * 2.2);
      c.save();
      c.globalAlpha = 0.55 + core * 0.3;
      c.fillStyle = '#e0f2fe';
      c.beginPath();
      c.arc(
        centerRect.x + centerRect.w / 2,
        centerRect.y + centerRect.h / 2,
        3 + core * 3,
        0,
        Math.PI * 2
      );
      c.fill();
      c.restore();
      drawGlow(
        c,
        centerRect.x + centerRect.w / 2,
        centerRect.y + centerRect.h / 2,
        20 + core * 14,
        '#a5f3fc',
        0.3 + core * 0.25 + flashBC
      );
      drawStaticPanel(c, centerRect, t, '#e0f2fe', 0.3);
      if (eraC && t > 88.4) {
        const surge = smoothstep(88.4, 90, t);
        c.fillStyle = `rgba(224,242,254,${surge * 0.5})`;
        c.fillRect(0, 0, FB_W, FB_H);
      }
    }

    if (flashAB > 0.02 || flashBC > 0.02) {
      const flash = Math.max(flashAB, flashBC);
      c.fillStyle = `rgba(165,243,252,${flash * 0.22})`;
      c.fillRect(0, 0, FB_W, FB_H);
    }

    drawMotes(c, t, 40, 60, 400, 170, 22, '#fde68a', 0.18, 5);
    drawMotes(c, t, 90, 80, 300, 120, 12, '#a5f3fc', 0.14, 4);
  }

  drawReflectionStreak(c, 240, 238, 26, 18, '#22d3ee', 0.05);
  drawHero(c, 240, 233, 2, t, {
    backView: true,
    auraStrength: 0.22,
    shadow: true,
  });
}

/* -------------------------------------------------------------------------
   CAP. 5 · 01:30–01:52 — LA ISLA DE LOS ORÍGENES
   ------------------------------------------------------------------------- */
function renderScene5(c: CanvasRenderingContext2D, t: number): void {
  const reveal = smoothstep(90, 106, t);
  const cam = makeCam(lerp(238, 246, reveal), lerp(96, 145, reveal), lerp(1.14, 1.035, reveal));
  if (!drawBackdrop(c, 'island', cam, 1)) drawFallback(c, 'island');
  const p = makeProjector('island', cam);

  if (p) {
    const sun = p(155, 267);
    drawGlow(c, sun.x, sun.y, 30, '#fcd34d', 0.32 + Math.sin(t * 0.7) * 0.05);
    drawGlow(c, sun.x, sun.y, 12, '#fff7ed', 0.32);

    for (let i = 0; i < 26; i++) {
      const gx = 80 + hash(i * 3.7) * 640;
      const gy = 540 + hash(i * 9.1) * 290;
      const pos = p(gx, gy);
      const tw = Math.abs(Math.sin(t * 1.1 + i * 1.7));
      c.globalAlpha = 0.12 + tw * 0.25;
      c.fillStyle = i % 4 === 0 ? '#fde68a' : '#a5f3fc';
      c.fillRect(Math.round(pos.x), Math.round(pos.y), 1 + Math.floor(hash(i) * 4), 1);
    }
    c.globalAlpha = 1;

    for (let i = 0; i < 22; i++) {
      const base = p(600 + hash(i * 3.3) * 620, 430 + hash(i * 7.7) * 200);
      const x = base.x + Math.sin(t * 0.8 + i) * 5;
      const y = base.y + Math.cos(t * 1.1 + i * 2) * 3;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i));
      drawGlow(c, x, y, 3, i % 3 === 0 ? '#fef3c7' : '#fbbf24', 0.28 * tw);
    }

    for (let i = 0; i < 3; i++) {
      const bx = 250 + i * 14 + Math.sin(t * 0.3 + i) * 6;
      const by = 70 - i * 5 + Math.cos(t * 0.4 + i) * 3;
      const wing = Math.sin(t * 2.5 + i) * 1.5;
      c.strokeStyle = 'rgba(15,23,42,0.65)';
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(bx - 3, by + wing);
      c.lineTo(bx, by);
      c.lineTo(bx + 3, by + wing);
      c.stroke();
    }
  }

  if (t >= 96.4) {
    const drop = smoothstep(96.4, 102.6, t);
    const landed = t >= 102.6;
    const walk = smoothstep(103.2, 110.5, t);
    const feetX = landed ? lerp(196, 232, walk) : lerp(68, 196, drop);
    const feetY = landed
      ? 188 + Math.sin(t * 9) * (walk > 0 && walk < 1 ? 0.6 : 0)
      : lerp(38, 188, drop * drop);
    const scale = 1.45;

    if (!landed) {
      for (let i = 1; i <= 5; i++) {
        const u = Math.max(0, drop - i * 0.055);
        const tx = lerp(68, 196, u);
        const ty = lerp(38, 188, u * u);
        drawGlow(c, tx, ty, 4, '#67e8f9', (1 - i / 6) * 0.35);
      }
      drawGlow(c, feetX, feetY - 14, 16, '#a5f3fc', 0.24);
    } else {
      const landAge = t - 102.6;
      if (landAge < 1.1) {
        const u = landAge / 1.1;
        drawRing(c, feetX, feetY + 1, 3 + u * 26, '#fde68a', 0.4 * (1 - u));
        drawRing(c, feetX, feetY + 1, 2 + u * 18, '#67e8f9', 0.3 * (1 - u));
      }
    }

    drawHero(c, feetX, feetY, scale, t, {
      backView: true,
      running: landed && walk > 0 && walk < 1,
      auraStrength: landed ? 0.22 : 0.55,
      shadow: landed,
    });
  }
}

/* -------------------------------------------------------------------------
   CAP. 6 · 01:52–02:12 — LAS PUERTAS DEL ORIGEN
   ------------------------------------------------------------------------- */
function renderGate(c: CanvasRenderingContext2D, t: number): void {
  const k = smoothstep(112, 121.5, t);
  const open = smoothstep(112.6, 120.6, t);
  const cam = makeCam(
    lerp(250, 259, k),
    lerp(96, 92, k),
    lerp(1.04, 1.15, k),
    Math.sin(t * 31) * cuePulse(t, 120.2, 4) * 1.2
  );
  if (!drawBackdrop(c, 'gate', cam, 1)) drawFallback(c, 'gate');
  const p = makeProjector('gate', cam);
  const panel: HoloRect = { x: 176, y: 82, w: 64, h: 50 };

  if (p) {
    const core = p(975, 345);
    const lantern = p(330, 600);
    const flicker = 0.75 + 0.25 * Math.sin(t * 8.3) + 0.08 * Math.sin(t * 19.1);
    drawGlow(c, lantern.x, lantern.y, 18, '#fbbf24', 0.36 * flicker);
    drawGlow(c, lantern.x, lantern.y, 6, '#fef3c7', 0.4 * flicker);

    const pulse = 0.5 + 0.5 * Math.sin(t * 2.1);
    drawGlow(c, core.x, core.y, 14 + open * 26 + pulse * 4, '#67e8f9', 0.2 + open * 0.3);
    drawGlow(c, core.x, core.y, 5, '#ffffff', 0.28 + open * 0.24);

    const slitH = lerp(5, 30, open);
    const slitW = 1 + open * 4;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.fillStyle = 'rgba(224,242,254,0.85)';
    c.fillRect(
      Math.round(core.x - slitW / 2),
      Math.round(core.y - slitH),
      Math.round(slitW),
      Math.round(slitH * 2)
    );
    c.fillStyle = 'rgba(0,243,255,0.5)';
    c.fillRect(
      Math.round(core.x - slitW),
      Math.round(core.y - slitH * 1.25),
      Math.round(slitW * 2),
      Math.round(slitH * 2.5)
    );
    c.restore();

    if (open > 0.05) {
      for (let i = 0; i < 3; i++) {
        const age = (t * 0.8 + i * 0.7) % 2.1;
        drawRing(c, core.x, core.y, 6 + age * 34, '#a5f3fc', 0.2 * (1 - age / 2.1) * open);
      }
    }

    drawReflectionStreak(c, core.x, core.y + 36, 10 + open * 20, 62, '#67e8f9', 0.1 + open * 0.18);

    c.save();
    c.globalAlpha = 0.14 + open * 0.18;
    c.strokeStyle = '#67e8f9';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(core.x + 6, core.y);
    c.lineTo(panel.x + panel.w, panel.y + panel.h * 0.5);
    c.stroke();
    c.restore();

    drawMotes(c, t, 30, 90, 360, 130, 24, '#c4b5fd', 0.26, 6);
    drawMotes(c, t, 30, 90, 360, 130, 10, '#fde68a', 0.14, 4);
  }

  const panelAlpha =
    smoothstep(113.8, 115.6, t) * (1 - smoothstep(120.9, 121.5, t) * 0.7);
  if (panelAlpha > 0.01) {
    holoFrame(c, panel, '#67e8f9', panelAlpha * 0.9);
    c.save();
    c.globalAlpha = panelAlpha;
    c.beginPath();
    c.rect(panel.x, panel.y, panel.w, panel.h);
    c.clip();
    drawBreakoutHolo(c, panel, t, '#67e8f9');
    c.restore();
    drawGlow(
      c,
      panel.x + panel.w / 2,
      panel.y + panel.h / 2,
      30,
      '#22d3ee',
      panelAlpha * 0.1
    );
  }

  const approach = smoothstep(112.5, 121.3, t);
  const feetX = lerp(132, 158, approach);
  const feetY =
    227 + Math.round(Math.sin(t * 7.2) * (approach > 0.03 && approach < 0.97 ? 1 : 0));
  if (t < 121.5) {
    drawHero(c, feetX, feetY, 2, t, {
      backView: true,
      running: approach > 0.04 && approach < 0.95,
      auraStrength: 0.3,
      shadow: true,
    });
    drawReflectionStreak(c, feetX, feetY + 2, 18, 10, '#67e8f9', 0.06);
  }

  if (t > 120.3) {
    const surge = smoothstep(120.3, 121.45, t);
    c.fillStyle = `rgba(224,242,254,${surge * 0.72})`;
    c.fillRect(0, 0, FB_W, FB_H);
  }
}

function renderCrono(c: CanvasRenderingContext2D, t: number): void {
  const k = smoothstep(121.5, 132, t);
  const cam = makeCam(237, 101, lerp(1.03, 1.125, k));
  if (!drawBackdrop(c, 'crono', cam, 1)) drawFallback(c, 'crono');
  const p = makeProjector('crono', cam);

  if (p) {
    const core = p(888, 380);
    const ignition = smoothstep(121.5, 125.5, t);
    const beat = Math.max(
      cuePulse(t, 122, 2.2),
      cuePulse(t, 126.4, 2.4) * 0.7,
      cuePulse(t, 129.4, 2.4) * 0.5
    );
    drawGlow(
      c,
      core.x,
      core.y,
      26 + ignition * 12 + beat * 18,
      '#67e8f9',
      0.16 + ignition * 0.16 + beat * 0.1
    );
    drawGlow(c, core.x, core.y, 8, '#ffffff', 0.24 + beat * 0.2);

    c.save();
    c.strokeStyle = 'rgba(253,230,138,0.4)';
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(core.x, core.y, 32, 12, t * 0.22, 0, Math.PI * 1.55);
    c.stroke();
    c.strokeStyle = 'rgba(103,232,249,0.35)';
    c.beginPath();
    c.ellipse(core.x, core.y, 24, 46, -t * 0.16, 0.4, Math.PI * 1.4);
    c.stroke();
    c.restore();

    for (let i = 0; i < 9; i++) {
      const angle = t * (0.35 + i * 0.015) + (i / 9) * Math.PI * 2;
      const radius = 34 + (i % 3) * 11;
      const sx = core.x + Math.cos(angle) * radius;
      const sy = core.y + Math.sin(angle) * radius * 0.55;
      drawGlow(c, sx, sy, 3, i % 3 === 0 ? '#fde68a' : '#67e8f9', 0.3);
    }

    drawMotes(c, t, core.x - 60, core.y + 20, 120, 110, 20, '#fde68a', 0.24, 4);
    drawRing(
      c,
      core.x,
      core.y,
      10 + ((t * 22) % 44),
      '#fde68a',
      0.18 * (1 - ((t * 22) % 44) / 44)
    );
  }

  drawReflectionStreak(c, 238, 242, 30, 16, '#fde68a', 0.08);
  drawHero(c, 238, 237, 2.5, t, {
    backView: true,
    auraStrength: 0.42,
    shadow: true,
  });

  if (t > 129.2) {
    const bite = smoothstep(129.2, 132, t);
    drawSignalCorruption(c, t, bite * 0.7);
    if (bite > 0.5) {
      drawGlitchSlices(c, 'crono', cam, t, bite * 0.55);
    }
  }
}

function renderScene6(c: CanvasRenderingContext2D, t: number): void {
  if (t < 121.5) renderGate(c, t);
  else renderCrono(c, t);
}

/* -------------------------------------------------------------------------
   CAP. 7 · 02:12–02:24 — EL SENDERO GLITCH
   ------------------------------------------------------------------------- */
const GLITCH_BURSTS = [132.25, 133.75, 135.2, 136.9, 138.3, 139.65, 141.2, 142.65];

function glitchIntensityAt(t: number): number {
  let v = 0.1;
  for (const burst of GLITCH_BURSTS) {
    v = Math.max(v, Math.exp(-Math.abs(t - burst) * 4.8));
  }
  if (t > 143.1) v = Math.max(v, smoothstep(143.1, 144, t));
  return clamp01(v);
}

function renderScene7(c: CanvasRenderingContext2D, t: number): void {
  const gi = glitchIntensityAt(t);
  const running = t < 138.3;
  const shake = gi * 2.4;
  const cam = running
    ? makeCam(
        lerp(208, 300, smoothstep(132, 138.3, t)),
        lerp(152, 145, smoothstep(132, 138.3, t)),
        lerp(1.06, 1.1, smoothstep(132, 138.3, t)),
        Math.sin(t * 47) * shake,
        Math.cos(t * 39) * shake * 0.7
      )
    : makeCam(298, 145, 1.1, Math.sin(t * 47) * shake, Math.cos(t * 39) * shake * 0.7);

  if (!drawBackdrop(c, 'glitch', cam, 1)) drawFallback(c, 'glitch');
  drawGlitchSlices(c, 'glitch', cam, t, gi);
  drawSignalCorruption(c, t, gi);
  drawSpeedLines(c, t, gi);

  c.save();
  c.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 3; i++) {
    c.globalAlpha = 0.05 + gi * 0.1;
    c.strokeStyle = i === 0 ? '#f0abfc' : i === 1 ? '#67e8f9' : '#fbbf24';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(FB_W + 20, 40 + i * 30 + Math.sin(t * 0.7 + i) * 12);
    c.lineTo(180 + i * 50, FB_H + 10);
    c.stroke();
  }
  c.restore();

  if (running) {
    const runT = smoothstep(132.1, 138.2, t);
    const hx = lerp(80, 356, runT);
    const foot = 230 + Math.sin(t * 13) * 1.4;
    for (let i = 3; i >= 1; i--) {
      c.save();
      c.globalAlpha = 0.06 + (3 - i) * 0.03;
      drawHero(c, hx - i * 13, foot, 2.2, t - i * 0.045, {
        running: true,
        backView: true,
        auraStrength: 0,
      });
      c.restore();
    }
    drawHero(c, hx, foot, 2.2, t, {
      running: true,
      backView: true,
      auraStrength: 0.38,
      shadow: true,
    });
    for (let i = 0; i < 5; i++) {
      const age = (t * 2.2 + i * 0.37) % 1;
      drawShard(
        c,
        hx - 18 - age * 40,
        foot - 20 - age * 22 + Math.sin(i + t) * 4,
        1.6,
        i % 2 === 0 ? '#67e8f9' : '#f0abfc',
        (1 - age) * 0.55
      );
    }
    if (t > 138.2) {
      const out = smoothstep(138.2, 138.55, t);
      c.fillStyle = `rgba(235,255,255,${out * 0.8})`;
      c.fillRect(0, 0, FB_W, FB_H);
    }
  }

  if (!running) {
    const beamW = 5 + gi * 8;
    c.save();
    c.globalCompositeOperation = 'lighter';
    const grad = c.createLinearGradient(0, 0, 0, FB_H);
    grad.addColorStop(0, 'rgba(224,242,254,0.15)');
    grad.addColorStop(0.55, 'rgba(103,232,249,0.5)');
    grad.addColorStop(1, 'rgba(240,171,252,0.12)');
    c.fillStyle = grad;
    c.fillRect(240 - beamW / 2, 0, beamW, FB_H);
    c.fillStyle = 'rgba(255,255,255,0.65)';
    c.fillRect(239, 0, 2, FB_H);
    c.restore();
    drawGlow(c, 240, 132, 34 + gi * 22, '#67e8f9', 0.18 + gi * 0.16);
    drawGlow(c, 240, 132, 12, '#ffffff', 0.22);

    for (let i = 0; i < 4; i++) {
      const age = (t * 0.75 + i * 0.55) % 2.2;
      drawRing(
        c,
        240,
        132,
        8 + age * 46,
        i % 2 === 0 ? '#a5f3fc' : '#f0abfc',
        0.24 * (1 - age / 2.2)
      );
    }

    const eyes = drawEyeCutIn(c, t);
    if (eyes.alpha > 0.02) {
      drawSignalCorruption(c, t * 1.3, gi * 0.8);
    }

    const stand = smoothstep(138.8, 139.5, t);
    if (stand > 0.01) {
      c.save();
      c.globalAlpha = stand;
      drawHero(c, 240, 240, 2.7, t, {
        backView: true,
        auraStrength: 0.55 + cuePulse(t, 143.5, 2) * 0.4,
        shadow: true,
      });
      c.restore();
      drawReflectionStreak(c, 240, 243, 30, 14, '#a5f3fc', stand * 0.08);
    }

    drawMotes(c, t, 60, 120, 360, 130, 18, '#e0f2fe', 0.24, 7);

    if (t > 143.45) {
      const surge = smoothstep(143.45, 144, t);
      c.fillStyle = `rgba(240,253,255,${surge * 0.9})`;
      c.fillRect(0, 0, FB_W, FB_H);
    }
  }
}

/* -------------------------------------------------------------------------
   CAP. 8 · 02:24–02:30 — EL EMBLEMA
   ------------------------------------------------------------------------- */
function renderScene8(c: CanvasRenderingContext2D, t: number): void {
  const k = smoothstep(144, 150, t);
  const cam = makeCam(241, 135, lerp(1.12, 1.03, k));
  if (!drawBackdrop(c, 'emblem', cam, 0.92)) drawFallback(c, 'emblem');

  c.fillStyle = 'rgba(2,3,10,0.46)';
  c.fillRect(0, 0, FB_W, FB_H);

  const p = makeProjector('emblem', cam);
  const cx = p ? p(896, 512).x : FB_W / 2;
  const cy = p ? p(896, 512).y : FB_H / 2;
  const titlePulse = cuePulse(t, 144.1, 1.6);

  drawGlow(c, cx, cy, 52 + titlePulse * 26, '#fbbf24', 0.12 + titlePulse * 0.18);
  drawGlow(c, cx, cy, 24, '#67e8f9', 0.14 + titlePulse * 0.12);

  c.save();
  c.strokeStyle = 'rgba(253,230,138,0.32)';
  c.lineWidth = 1;
  c.beginPath();
  c.ellipse(cx, cy + 8, 62, 20, Math.sin(t * 0.12) * 0.12, 0, Math.PI * 2);
  c.stroke();
  c.strokeStyle = 'rgba(103,232,249,0.28)';
  c.beginPath();
  c.ellipse(cx, cy + 8, 44, 58, -0.25 + Math.sin(t * 0.1) * 0.08, 0.3, Math.PI * 1.7);
  c.stroke();
  c.restore();

  for (let i = 0; i < 26; i++) {
    const angle = hash(i * 3.1) * Math.PI * 2;
    const radius = lerp(
      150 + hash(i * 7.7) * 130,
      8,
      smoothstep(144.1, 148.2, t + hash(i) * 1.6)
    );
    const sx = cx + Math.cos(angle) * radius;
    const sy = cy + Math.sin(angle) * radius * 0.62;
    const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * 2.4 + i));
    c.globalAlpha = tw * 0.7;
    c.fillStyle = i % 3 === 0 ? '#fde68a' : '#67e8f9';
    c.fillRect(Math.round(sx), Math.round(sy), i % 5 === 0 ? 2 : 1, 1);
  }
  c.globalAlpha = 1;

  drawMotes(c, t, 90, 50, 300, 180, 24, '#a5f3fc', 0.18, 5);
  drawMotes(c, t, 90, 50, 300, 180, 10, '#fde68a', 0.16, 4);

  if (t > 149.1) {
    c.fillStyle = `rgba(0,0,0,${smoothstep(149.1, 150, t) * 0.92})`;
    c.fillRect(0, 0, FB_W, FB_H);
  }
}

/* =========================================================================
   FÁBRICA / POST-PROCESO
   ========================================================================= */

const PRELOAD_SCHEDULE: { at: number; key: BackdropKey }[] = [
  { at: 0, key: 'bedroom' },
  { at: 18, key: 'arcade' },
  { at: 22, key: 'city' },
  { at: 40, key: 'cosmos' },
  { at: 62, key: 'hall' },
  { at: 85, key: 'island' },
  { at: 106, key: 'gate' },
  { at: 116, key: 'crono' },
  { at: 126, key: 'glitch' },
  { at: 138, key: 'emblem' },
];

export function createCinematicWorld64Bit(mountEl: HTMLElement): CinematicWorldController {
  const displayCanvas = document.createElement('canvas');
  displayCanvas.style.width = '100%';
  displayCanvas.style.height = '100%';
  displayCanvas.style.display = 'block';
  displayCanvas.style.imageRendering = 'pixelated';
  mountEl.innerHTML = '';
  mountEl.appendChild(displayCanvas);

  const fbCanvas = document.createElement('canvas');
  fbCanvas.width = FB_W;
  fbCanvas.height = FB_H;

  const dispCtx = displayCanvas.getContext('2d');
  const ctx = fbCanvas.getContext('2d');

  let viewW = mountEl.clientWidth || window.innerWidth;
  let viewH = mountEl.clientHeight || window.innerHeight;

  const resize = (w: number, h: number) => {
    viewW = Math.max(1, w);
    viewH = Math.max(1, h);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    displayCanvas.width = Math.floor(viewW * dpr);
    displayCanvas.height = Math.floor(viewH * dpr);
    if (dispCtx) dispCtx.imageSmoothingEnabled = false;
  };
  resize(viewW, viewH);

  // ---- Post-proceso cacheado ----
  const vignetteCanvas = document.createElement('canvas');
  vignetteCanvas.width = FB_W;
  vignetteCanvas.height = FB_H;
  const vignetteCtx = vignetteCanvas.getContext('2d');
  if (vignetteCtx) {
    const g = vignetteCtx.createRadialGradient(
      FB_W / 2,
      FB_H / 2,
      Math.min(FB_W, FB_H) * 0.32,
      FB_W / 2,
      FB_H / 2,
      Math.max(FB_W, FB_H) * 0.68
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.72, 'rgba(0,0,0,0.18)');
    g.addColorStop(1, 'rgba(0,0,0,0.62)');
    vignetteCtx.fillStyle = g;
    vignetteCtx.fillRect(0, 0, FB_W, FB_H);
  }

  const scanCanvas = document.createElement('canvas');
  scanCanvas.width = 1;
  scanCanvas.height = 4;
  const scanCtx = scanCanvas.getContext('2d');
  if (scanCtx) {
    scanCtx.fillStyle = 'rgba(0,0,0,0.34)';
    scanCtx.fillRect(0, 0, 1, 1);
    scanCtx.fillStyle = 'rgba(0,0,0,0.08)';
    scanCtx.fillRect(0, 2, 1, 1);
  }
  const scanPattern = ctx ? ctx.createPattern(scanCanvas, 'repeat') : null;

  const grainCanvases: HTMLCanvasElement[] = [];
  for (let g = 0; g < 3; g++) {
    const gc = document.createElement('canvas');
    gc.width = 160;
    gc.height = 90;
    const gg = gc.getContext('2d');
    if (!gg) continue;
    const imgData = gg.createImageData(160, 90);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const v = hash(i * 0.37 + g * 91.7) > 0.5 ? 255 : 0;
      imgData.data[i] = v;
      imgData.data[i + 1] = v;
      imgData.data[i + 2] = v;
      imgData.data[i + 3] = Math.floor(hash(i * 1.13 + g * 17.3) * 90);
    }
    gg.putImageData(imgData, 0, 0);
    grainCanvases.push(gc);
  }

  const applyPost = (c: CanvasRenderingContext2D, t: number) => {
    if (vignetteCtx) c.drawImage(vignetteCanvas, 0, 0);
    if (scanPattern) {
      c.save();
      c.globalAlpha = 0.6;
      c.fillStyle = scanPattern;
      c.fillRect(0, 0, FB_W, FB_H);
      c.restore();
    }
    if (grainCanvases.length > 0) {
      const grain = grainCanvases[Math.floor(t * 9) % grainCanvases.length];
      c.save();
      c.globalAlpha = 0.05;
      c.imageSmoothingEnabled = false;
      c.drawImage(
        grain,
        (Math.floor(t * 13) % 5) - 2,
        (Math.floor(t * 17) % 5) - 2,
        FB_W + 4,
        FB_H + 4
      );
      c.restore();
    }
  };

  const primeBackdrops = (t: number) => {
    for (const item of PRELOAD_SCHEDULE) {
      if (t >= item.at) ensureBackdrop(item.key);
    }
  };

  ensureBackdrop('bedroom');
  ensureBackdrop('arcade');

  const renderAtTime = (tSec: number) => {
    if (!ctx || !dispCtx) return;
    const t = Math.max(0, tSec);
    primeBackdrops(t);

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;

    if (t < 18) renderScene1(ctx, t);
    else if (t < 42) renderScene2(ctx, t);
    else if (t < 65) renderScene3(ctx, t);
    else if (t < 90) renderScene4(ctx, t);
    else if (t < 112) renderScene5(ctx, t);
    else if (t < 132) renderScene6(ctx, t);
    else if (t < 144) renderScene7(ctx, t);
    else renderScene8(ctx, t);

    applyPost(ctx, t);

    const cut = cutEffects(t);
    if (cut.dip > 0.01) {
      ctx.fillStyle = `rgba(1,2,7,${cut.dip * 0.62})`;
      ctx.fillRect(0, 0, FB_W, FB_H);
    }
    if (cut.flash > 0.01) {
      ctx.fillStyle = `rgba(226,248,255,${cut.flash * 0.52})`;
      ctx.fillRect(0, 0, FB_W, FB_H);
    }

    const dw = displayCanvas.width;
    const dh = displayCanvas.height;
    dispCtx.imageSmoothingEnabled = false;
    dispCtx.fillStyle = '#010206';
    dispCtx.fillRect(0, 0, dw, dh);

    const scale = Math.max(dw / FB_W, dh / FB_H);
    const drawW = Math.round(FB_W * scale);
    const drawH = Math.round(FB_H * scale);
    const ox = Math.round((dw - drawW) / 2);
    const oy = Math.round((dh - drawH) / 2);
    dispCtx.drawImage(fbCanvas, ox, oy, drawW, drawH);
  };

  const dispose = () => {
    if (displayCanvas.parentNode === mountEl) {
      mountEl.removeChild(displayCanvas);
    }
  };

  return { resize, renderAtTime, dispose };
}
