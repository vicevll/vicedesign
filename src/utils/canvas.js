export function generateId() { return 'l_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6); }
export function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

export function hslToRgb(h, s, l) {
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1/6) return p + (q - p) * 6 * t; if (t < 1/2) return q; if (t < 2/3) return p + (q - p) * (2/3 - t) * 6; return p; };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1/3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
}

export function hexToRgb(hex) {
  return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
}

export function createSolidImageData(w, h, r, g, b, a) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = `rgba(${r},${g},${b},${a/255})`; ctx.fillRect(0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// ---- Shape rendering utilities ----
export function drawRoundedRect(ctx, x, y, w, h, rTL, rTR, rBL, rBR) {
  const tl = Math.min(rTL||0, w/2, h/2);
  const tr = Math.min(rTR||0, w/2, h/2);
  const bl = Math.min(rBL||0, w/2, h/2);
  const br = Math.min(rBR||0, w/2, h/2);
  ctx.beginPath();
  if (tl === 0 && tr === 0 && bl === 0 && br === 0) { ctx.rect(x, y, w, h); }
  else {
    ctx.moveTo(x + tl, y);
    ctx.lineTo(x + w - tr, y);
    ctx.arcTo(x + w, y, x + w, y + tr, tr);
    ctx.lineTo(x + w, y + h - br);
    ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
    ctx.lineTo(x + bl, y + h);
    ctx.arcTo(x, y + h, x, y + h - bl, bl);
    ctx.lineTo(x, y + tl);
    ctx.arcTo(x, y, x + tl, y, tl);
    ctx.closePath();
  }
  ctx.fill();
}

export function polygonPoints(cx, cy, r, sides) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 / sides) * i - Math.PI / 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

export function starPoints(cx, cy, outerR, innerR, spikes) {
  const pts = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

export function drawRoundedPath(ctx, pts, radius) {
  const len = pts.length;
  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    const prev = pts[(i + len - 1) % len];
    const curr = pts[i];
    const next = pts[(i + 1) % len];
    const dx1 = curr.x - prev.x, dy1 = curr.y - prev.y;
    const d1 = Math.sqrt(dx1*dx1 + dy1*dy1) || 1;
    const dx2 = next.x - curr.x, dy2 = next.y - curr.y;
    const d2 = Math.sqrt(dx2*dx2 + dy2*dy2) || 1;
    const r = Math.min(radius, d1/2, d2/2);
    const sx = curr.x - (dx1/d1) * r;
    const sy = curr.y - (dy1/d1) * r;
    const ex = curr.x + (dx2/d2) * r;
    const ey = curr.y + (dy2/d2) * r;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
    ctx.arcTo(curr.x, curr.y, ex, ey, r);
  }
  ctx.closePath();
}

export function renderShapeLayer(ctx, layer) {
  const x = layer.x, y = layer.y, w = layer.width, h = layer.height;
  const hasGrad = layer.gradColor1 && layer.gradColor2;
  if (hasGrad) {
    const x1 = x, y1 = y, x2 = layer.gradDir === 'h' ? x + w : (layer.gradDir === 'd' ? x + w : x);
    const y2 = layer.gradDir === 'v' ? y + h : (layer.gradDir === 'd' ? y + h : y);
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, layer.gradColor1); g.addColorStop(1, layer.gradColor2);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = layer.fillColor || '#6366f1';
  }
  switch (layer.shapeType) {
    case 'rect':
      drawRoundedRect(ctx, x, y, w, h, layer.cornerTL, layer.cornerTR, layer.cornerBL, layer.cornerBR);
      break;
    case 'circle':
      ctx.beginPath();
      ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'polygon': {
      const r = Math.min(w, h) / 2;
      const pts = polygonPoints(x + w/2, y + h/2, r, layer.sides || 5);
      if (layer.cornerRadius > 0) drawRoundedPath(ctx, pts, layer.cornerRadius);
      else { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); }
      ctx.fill();
      break;
    }
    case 'star': {
      const pts = starPoints(x + w/2, y + h/2, w/2, w/3.5, layer.sides || 5);
      if (layer.cornerRadius > 0) drawRoundedPath(ctx, pts, layer.cornerRadius);
      else { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i=1;i<pts.length;i++) ctx.lineTo(pts[i].x, pts[i].y); ctx.closePath(); }
      ctx.fill();
      break;
    }
    case 'line':
      ctx.strokeStyle = layer.fillColor;
      ctx.lineWidth = layer.strokeWidth || 4;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.stroke();
      break;
  }
}

export function getLayerBounds(layer, canvasW, canvasH) {
  const x = layer.x || 0, y = layer.y || 0;
  if (layer.type === 'text') {
    const s = layer.fontSize || 48;
    const tw = Math.max(20, (layer.text || '').length * s * 0.55);
    return { x, y, w: tw, h: s };
  }
  if (layer.type === 'line') return { x, y, w: layer.width || 200, h: layer.height || 4 };
  // For raster layers, use layer dimensions (ImageData size matches)
  if (layer.type === 'raster' && layer.width != null && layer.height != null && layer.width > 0 && layer.height > 0) {
    return { x: layer.x || 0, y: layer.y || 0, w: layer.width, h: layer.height };
  }
  const w = layer.width != null ? layer.width : (layer.type === 'shape' ? 200 : canvasW);
  const h = layer.height != null ? layer.height : (layer.type === 'shape' ? 200 : canvasH);
  return { x, y, w, h };
}

const boundsCache = new WeakMap();

function getRasterContentBounds(imgData) {
  if (boundsCache.has(imgData)) return boundsCache.get(imgData);
  const { data, width, height } = imgData;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  let hasContent = false;
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (data[(py * width + px) * 4 + 3] > 0) {
        hasContent = true;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
    }
  }
  if (!hasContent) return null;
  const result = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  boundsCache.set(imgData, result);
  return result;
}

export function isInsideLayer(layer, imgX, imgY, canvasW, canvasH) {
  const b = getLayerBounds(layer, canvasW, canvasH);
  return imgX >= b.x && imgX <= b.x + b.w && imgY >= b.y && imgY <= b.y + b.h;
}

// ---- Security sanitization ----
export function sanitizeText(str) {
  if (!str) return '';
  let s = str.replace(/<[^>]*>/g, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\bon\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/data:[\s\S]*?base64[\s\S]*?/gi, '[base64]');
  if (s.length > 5000) s = s.substring(0, 5000);
  return s;
}

export function sanitizeSVG(svgText) {
  if (!svgText) return '';
  return svgText
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\bon\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
}
