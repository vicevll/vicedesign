(function() {
  'use strict';

  // ============================================================
  //  STATE
  // ============================================================
  const state = {
    screen: 'landing',
    canvasWidth: 1920,
    canvasHeight: 1080,
    backgroundColor: 'white',
    layers: [],
    activeLayerId: null,
    activeTool: 'move',
    shapeColor: '#6366f1',
    brushColor: { r: 0, g: 0, b: 0 },
    wheelHue: 0,
    wheelSat: 0,
    wheelBri: 100,
    zoom: 1,
    panX: 0,
    panY: 0,
    isDragging: false,
    isPanning: false,
    dragStartX: 0,
    dragStartY: 0,
    dragLayerOrigX: 0,
    dragLayerOrigY: 0,
    dragLayerOrigW: 0,
    dragLayerOrigH: 0,
    selection: null,
    isDrawingSelection: false,
    selectionStartX: 0,
    selectionStartY: 0,
    isEditingText: false,
    _editingLayerId: null,
    _pendingTextX: 0,
    _pendingTextY: 0,
    resizeHandle: null,
    resizeStartX: 0,
    resizeStartY: 0,
  };

  // ============================================================
  //  DOM REFS
  // ============================================================
  const $landing = document.getElementById('landing-screen');
  const $editor = document.getElementById('editor-screen');
  const $canvas = document.getElementById('main-canvas');
  const $canvasCtx = $canvas.getContext('2d');
  const $canvasWrapper = document.getElementById('canvas-wrapper');
  const $canvasContainer = document.getElementById('canvas-container');
  const $layersList = document.getElementById('layers-list');
  const $canvasInfo = document.getElementById('canvas-info');
  const $zoomLevel = document.getElementById('zoom-level');
  const $textOverlay = document.getElementById('text-editor-overlay');
  const $textInput = document.getElementById('text-editor-input');
  const $colorSwatch = document.getElementById('active-color-swatch');
  const $colorHex = document.getElementById('active-color-hex');
  const $colorPicker = document.getElementById('color-picker-trigger');
  const $colorPopup = document.getElementById('color-wheel-popup');
  const $colorCanvas = document.getElementById('color-wheel-canvas');
  const $colorCtx = $colorCanvas.getContext('2d');
  const $cwBrightness = document.getElementById('cw-brightness');
  const $cwSwatch = document.getElementById('cw-swatch');
  const $cwHex = document.getElementById('cw-hex');
  const $modal = document.getElementById('setup-modal');
  const $loading = document.getElementById('loading-overlay');
  const $textSectionBody = document.getElementById('text-section-body');
  const $textPropsSection = document.getElementById('text-props-section');
  const $shapePropsDyn = document.getElementById('shape-props-dynamic');
  const $shapeSidesRow = document.getElementById('shape-sides-row');
  const $shapeColor = document.getElementById('shape-color');
  const $shapeRadius = document.getElementById('shape-radius');
  const $shapeSides = document.getElementById('shape-sides');

  // ============================================================
  //  UTILS
  // ============================================================
  function generateId() { return 'l_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6); }
  function clamp(v, mn, mx) { return Math.max(mn, Math.min(mx, v)); }

  function canvasToImage(cx, cy) {
    const r = $canvas.getBoundingClientRect();
    return { x: (cx - r.left) / state.zoom, y: (cy - r.top) / state.zoom };
  }

  function hslToRgb(h, s, l) {
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

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  }

  function hexToRgb(hex) {
    return { r: parseInt(hex.slice(1,3),16), g: parseInt(hex.slice(3,5),16), b: parseInt(hex.slice(5,7),16) };
  }

  function updateColorUI() {
    const c = state.brushColor;
    const hex = rgbToHex(c.r, c.g, c.b);
    $colorSwatch.style.background = hex;
    $colorHex.textContent = hex;
    $cwSwatch.style.background = hex;
    $cwHex.value = hex;
  }

  // ============================================================
  //  COLOR WHEEL
  // ============================================================
  let wheelCache = null;

  function drawColorWheel() {
    const ctx = $colorCtx;
    const w = $colorCanvas.width, h = $colorCanvas.height;
    const cx = w / 2, cy = h / 2, r = w / 2 - 2;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - cx, dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * w + x) * 4;
        if (dist <= r) {
          const hue = ((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 360;
          const sat = Math.min(dist / r, 1) * 100;
          const rgb = hslToRgb(hue, sat, 50);
          img.data[idx] = rgb.r; img.data[idx+1] = rgb.g; img.data[idx+2] = rgb.b; img.data[idx+3] = 255;
        } else {
          img.data[idx] = 255; img.data[idx+1] = 255; img.data[idx+2] = 255; img.data[idx+3] = 0;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    wheelCache = ctx.getImageData(0, 0, w, h);
    drawWheelCrosshair();
  }

  function drawWheelCrosshair() {
    if (wheelCache) { $colorCtx.putImageData(wheelCache, 0, 0); }
    const w = $colorCanvas.width, cx = w / 2;
    const angle = state.wheelHue * Math.PI / 180;
    const dist = (state.wheelSat / 100) * (w / 2 - 4);
    const kx = cx + Math.cos(angle - Math.PI) * dist;
    const ky = cx + Math.sin(angle - Math.PI) * dist;
    const ctx = $colorCtx;
    ctx.beginPath(); ctx.arc(kx, ky, 5, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(kx, ky, 6, 0, Math.PI * 2); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.stroke();
  }

  function pickColorFromWheel(cx, cy) {
    const w = $colorCanvas.width, center = w / 2, r = w / 2 - 2;
    const dx = cx - center, dy = cy - center;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > r) return;
    state.wheelHue = ((Math.atan2(dy, dx) + Math.PI) / (Math.PI * 2)) * 360;
    state.wheelSat = Math.min(dist / r, 1) * 100;
    applyWheelColor();
  }

  function applyWheelColor() {
    const bri = parseInt($cwBrightness.value) || 100;
    state.wheelBri = bri;
    const hslRgb = hslToRgb(state.wheelHue, state.wheelSat, 50);
    const blend = (c, b) => Math.round(c + (b - c) * (bri / 100));
    state.brushColor = { r: blend(hslRgb.r, 255), g: blend(hslRgb.g, 255), b: blend(hslRgb.b, 255) };
    updateColorUI();
    drawWheelCrosshair();
  }

  function toggleColorWheel() {
    const vis = $colorPopup.style.display !== 'none';
    $colorPopup.style.display = vis ? 'none' : 'block';
    if (!vis) { drawColorWheel(); }
  }

  // ============================================================
  //  SCREEN SWITCHING
  // ============================================================
  function showLanding() {
    state.screen = 'landing';
    $landing.style.display = 'flex';
    $editor.style.display = 'none';
  }
  function showEditor() {
    state.screen = 'editor';
    $landing.style.display = 'none';
    $editor.style.display = 'grid';
    initEditor();
  }

  // ============================================================
  //  MODAL
  // ============================================================
  function openModal() {
    document.getElementById('modal-width').value = state.canvasWidth;
    document.getElementById('modal-height').value = state.canvasHeight;
    const presets = document.querySelectorAll('#setup-modal .preset-btn');
    presets.forEach(p => {
      p.classList.toggle('active', parseInt(p.dataset.w) === state.canvasWidth && parseInt(p.dataset.h) === state.canvasHeight);
    });
    $modal.style.display = 'flex';
    anime({ targets: '#setup-modal', opacity: [0, 1], duration: 250, easing: 'easeOutCubic' });
    anime({ targets: '.modal-card', scale: [0.92, 1], opacity: [0, 1], duration: 380, easing: 'easeOutExpo' });
  }

  function closeModal() {
    anime({ targets: '#setup-modal', opacity: [1, 0], duration: 200, easing: 'easeInCubic',
      complete: function() { $modal.style.display = 'none'; } });
  }

  function createProject() {
    closeModal();
    $loading.style.display = 'flex';
    anime({ targets: '.loader-spinner', rotate: '1turn', duration: 800, easing: 'easeInOutQuad', loop: true });
    setTimeout(function() {
      anime.remove('.loader-spinner');
      $loading.style.display = 'none';
      showEditor();
    }, 700);
  }

  // ============================================================
  //  LANDING INIT
  // ============================================================
  function initLanding() {
    anime({ targets: '.landing-header', opacity: [0, 1], translateY: [-20, 0], duration: 800, easing: 'easeOutExpo', delay: 200 });
    anime({ targets: '.hero-title', opacity: [0, 1], translateY: [-30, 0], duration: 900, easing: 'easeOutExpo', delay: 400 });
    anime({ targets: '.hero-subtitle', opacity: [0, 1], translateY: [-20, 0], duration: 800, easing: 'easeOutExpo', delay: 600 });
    anime({ targets: '.hero-actions', opacity: [0, 1], translateY: [-15, 0], duration: 700, easing: 'easeOutExpo', delay: 800 });
    anime({ targets: ['.blob-1', '.blob-2', '.blob-3'], opacity: [0, 0.5], scale: [0.8, 1], duration: 1200, easing: 'easeOutExpo', delay: 300 });
    document.getElementById('btn-start').addEventListener('click', openModal);
    document.getElementById('btn-contact').addEventListener('click', function() {
      alert('Contacto y precios - Proximamente');
    });
  }

  function initModal() {
    const presets = document.querySelectorAll('#setup-modal .preset-btn');
    const wIn = document.getElementById('modal-width');
    const hIn = document.getElementById('modal-height');
    presets.forEach(b => b.addEventListener('click', function() {
      presets.forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      state.canvasWidth = parseInt(this.dataset.w); state.canvasHeight = parseInt(this.dataset.h);
      wIn.value = state.canvasWidth; hIn.value = state.canvasHeight;
    }));
    wIn.addEventListener('input', function() { state.canvasWidth = parseInt(this.value) || 1; presets.forEach(p => p.classList.remove('active')); });
    hIn.addEventListener('input', function() { state.canvasHeight = parseInt(this.value) || 1; presets.forEach(p => p.classList.remove('active')); });
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-create').addEventListener('click', function() {
      state.canvasWidth = clamp(parseInt(wIn.value) || 1920, 1, 10000);
      state.canvasHeight = clamp(parseInt(hIn.value) || 1080, 1, 10000);
      createProject();
    });
    $modal.addEventListener('click', function(e) { if (e.target === $modal) closeModal(); });
  }

  // ============================================================
  //  SIDEBAR SECTIONS
  // ============================================================
  function initSidebarSections() {
    document.querySelectorAll('.section-header').forEach(header => {
      header.addEventListener('click', function() {
        const body = this.nextElementSibling;
        const isHidden = body.classList.toggle('hidden');
        this.classList.toggle('collapsed', isHidden);
      });
    });
  }

  // ============================================================
  //  EDITOR INIT
  // ============================================================
  function initEditor() {
    state.layers = []; state.activeLayerId = null; state.activeTool = 'move';
    state.zoom = 1; state.panX = 0; state.panY = 0;
    state.selection = null; state.brushColor = { r: 0, g: 0, b: 0 };
    state.resizeHandle = null;
    updateColorUI();
    createBackgroundLayer();
    fitCanvas();
    renderComposite();
    updateLayerPanel();
    updateToolUI();
    updateCanvasInfo();
    updateShapePropsVisibility();
    updateTextSectionVisibility();
    $textOverlay.style.display = 'none'; $textOverlay.classList.remove('active');
    state.isEditingText = false; state._editingLayerId = null;
    $colorPopup.style.display = 'none';
  }

  function createBackgroundLayer() {
    const layer = {
      id: generateId(), name: 'Fondo', type: 'raster', visible: true, locked: true, opacity: 1,
      x: 0, y: 0, width: state.canvasWidth, height: state.canvasHeight, content: null,
    };
    if (state.backgroundColor === 'white') {
      layer.content = createSolidImageData(state.canvasWidth, state.canvasHeight, 255, 255, 255, 255);
    }
    state.layers.push(layer); state.activeLayerId = layer.id;
  }

  function createSolidImageData(w, h, r, g, b, a) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = `rgba(${r},${g},${b},${a/255})`; ctx.fillRect(0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  function updateCanvasInfo() {
    $canvasInfo.textContent = state.canvasWidth + ' x ' + state.canvasHeight + ' px';
    $zoomLevel.textContent = Math.round(state.zoom * 100) + '%';
  }

  // ============================================================
  //  ZOOM / PAN
  // ============================================================
  function applyPanTransform() {
    $canvasWrapper.style.transform = `translate(${state.panX}px, ${state.panY}px)`;
  }

  function fitCanvas() {
    const cw = $canvasContainer.clientWidth - 32;
    const ch = $canvasContainer.clientHeight - 32;
    state.zoom = Math.min(cw / state.canvasWidth, ch / state.canvasHeight, 1);
    state.panX = 0; state.panY = 0;
    $canvas.width = state.canvasWidth; $canvas.height = state.canvasHeight;
    $canvas.style.width = Math.round(state.canvasWidth * state.zoom) + 'px';
    $canvas.style.height = Math.round(state.canvasHeight * state.zoom) + 'px';
    applyPanTransform(); updateCanvasInfo();
  }

  function zoomAroundPoint(sx, sy, factor) {
    const r = $canvas.getBoundingClientRect();
    const mx = sx - r.left, my = sy - r.top;
    const oldZ = state.zoom;
    const ix = mx / oldZ, iy = my / oldZ;
    state.zoom = clamp(oldZ * factor, 0.05, 32);
    state.panX += ix * (oldZ - state.zoom);
    state.panY += iy * (oldZ - state.zoom);
    $canvas.style.width = Math.round(state.canvasWidth * state.zoom) + 'px';
    $canvas.style.height = Math.round(state.canvasHeight * state.zoom) + 'px';
    applyPanTransform(); updateCanvasInfo();
  }

  // ============================================================
  //  RENDER
  // ============================================================
  function renderComposite() {
    const ctx = $canvasCtx, w = state.canvasWidth, h = state.canvasHeight;
    ctx.clearRect(0, 0, w, h);
    drawCheckerboard(ctx, w, h);

    for (let i = 0; i < state.layers.length; i++) {
      const layer = state.layers[i];
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      if (layer.type === 'raster' && layer.content) {
        const tc = document.createElement('canvas'); tc.width = state.canvasWidth; tc.height = state.canvasHeight;
        tc.getContext('2d').putImageData(layer.content, 0, 0);
        const dw = layer.width != null ? layer.width : state.canvasWidth;
        const dh = layer.height != null ? layer.height : state.canvasHeight;
        ctx.drawImage(tc, 0, 0, state.canvasWidth, state.canvasHeight, layer.x, layer.y, dw, dh);
      } else if (layer.type === 'shape') {
        renderShape(ctx, layer);
      } else if (layer.type === 'text') {
        ctx.fillStyle = layer.textColor || '#000';
        const weight = layer.fontWeight || 'normal';
        const style = layer.fontStyle || 'normal';
        const size = layer.fontSize || 48;
        const family = layer.fontFamily || 'Inter Tight';
        ctx.font = style + ' ' + weight + ' ' + size + 'px "' + family + '"';
        ctx.textBaseline = 'top';
        ctx.fillText(layer.text || '', layer.x, layer.y);
      }
      ctx.restore();
    }

    if (state.selection) {
      ctx.save();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1 / state.zoom;
      ctx.strokeRect(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
      ctx.setLineDash([6, 4]); ctx.lineDashOffset = 6; ctx.strokeStyle = '#000';
      ctx.strokeRect(state.selection.x, state.selection.y, state.selection.w, state.selection.h);
      ctx.restore();
    }

    const al = getActiveLayer();
    if (al && al.visible && !al.locked && state.activeTool === 'move' && !state.isDragging) {
      drawResizeHandles(ctx, al);
    }
  }

  function drawCheckerboard(ctx, w, h) {
    const s = 12;
    for (let y = 0; y < h; y += s)
      for (let x = 0; x < w; x += s)
        ctx.fillStyle = ((x/s + y/s) % 2 === 0) ? '#d8d8d8' : '#ccc', ctx.fillRect(x, y, s, s);
  }

  // ---- Shape rendering ----
  function renderShape(ctx, layer) {
    const x = layer.x, y = layer.y, w = layer.width, h = layer.height;
    ctx.fillStyle = layer.fillColor || '#6366f1';
    switch (layer.shapeType) {
      case 'rect':
        drawRoundedRect(ctx, x, y, w, h, layer.cornerRadius || 0);
        break;
      case 'circle':
        ctx.beginPath();
        ctx.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'polygon':
        drawRoundedPoly(ctx, x + w/2, y + h/2, Math.min(w, h) / 2, layer.sides || 5, layer.cornerRadius || 0);
        break;
      case 'star':
        drawRoundedStar(ctx, x + w/2, y + h/2, w/2, w/3.5, layer.sides || 5, layer.cornerRadius || 0);
        break;
      case 'line':
        ctx.strokeStyle = layer.fillColor;
        ctx.lineWidth = layer.strokeWidth || 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y + h);
        ctx.stroke();
        break;
    }
  }

  function drawRoundedRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w/2, h/2);
    ctx.beginPath();
    if (r <= 0) {
      ctx.rect(x, y, w, h);
    } else {
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.arcTo(x + w, y, x + w, y + r, r);
      ctx.lineTo(x + w, y + h - r);
      ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
      ctx.lineTo(x + r, y + h);
      ctx.arcTo(x, y + h, x, y + h - r, r);
      ctx.lineTo(x, y + r);
      ctx.arcTo(x, y, x + r, y, r);
      ctx.closePath();
    }
    ctx.fill();
  }

  function polygonPoints(cx, cy, r, sides) {
    const pts = [];
    for (let i = 0; i < sides; i++) {
      const a = (Math.PI * 2 / sides) * i - Math.PI / 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }

  function drawRoundedPoly(ctx, cx, cy, r, sides, radius) {
    const pts = polygonPoints(cx, cy, r, sides);
    if (radius <= 0 || pts.length < 3) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
      return;
    }
    drawRoundedPath(ctx, pts, radius);
    ctx.fill();
  }

  function drawRoundedStar(ctx, cx, cy, outerR, innerR, spikes, radius) {
    const pts = [];
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const a = (Math.PI / spikes) * i - Math.PI / 2;
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    if (radius <= 0 || pts.length < 3) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fill();
      return;
    }
    drawRoundedPath(ctx, pts, radius);
    ctx.fill();
  }

  function drawRoundedPath(ctx, pts, radius) {
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

  // ============================================================
  //  RESIZE HANDLES
  // ============================================================
  function getLayerBounds(layer) {
    const x = layer.x || 0, y = layer.y || 0;
    if (layer.type === 'text') {
      const s = layer.fontSize || 48;
      const tw = Math.max(20, (layer.text || '').length * s * 0.55);
      return { x, y, w: tw, h: s };
    }
    if (layer.type === 'line') {
      return { x, y, w: layer.width || 200, h: layer.height || 4 };
    }
    const w = layer.width != null ? layer.width : (layer.type === 'shape' ? 200 : state.canvasWidth);
    const h = layer.height != null ? layer.height : (layer.type === 'shape' ? 200 : state.canvasHeight);
    return { x, y, w, h };
  }

  function drawResizeHandles(ctx, layer) {
    const b = getLayerBounds(layer);
    const hs = 8 / state.zoom, hh = hs / 2;
    const positions = [
      { id: 'nw', x: b.x - hh, y: b.y - hh }, { id: 'n', x: b.x + b.w/2 - hh, y: b.y - hh },
      { id: 'ne', x: b.x + b.w - hh, y: b.y - hh }, { id: 'e', x: b.x + b.w - hh, y: b.y + b.h/2 - hh },
      { id: 'se', x: b.x + b.w - hh, y: b.y + b.h - hh }, { id: 's', x: b.x + b.w/2 - hh, y: b.y + b.h - hh },
      { id: 'sw', x: b.x - hh, y: b.y + b.h - hh }, { id: 'w', x: b.x - hh, y: b.y + b.h/2 - hh },
    ];
    ctx.save();
    for (const p of positions) {
      const isCorner = ['nw','ne','se','sw'].includes(p.id);
      ctx.fillStyle = isCorner ? '#6366f1' : '#666';
      ctx.fillRect(p.x, p.y, hs, hs);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1 / state.zoom;
      ctx.strokeRect(p.x, p.y, hs, hs);
    }
    ctx.restore();
  }

  function findHandleAt(imgX, imgY, layer) {
    const b = getLayerBounds(layer);
    const hs = 8 / state.zoom, hh = hs / 2;
    const positions = [
      { id: 'nw', x: b.x - hh, y: b.y - hh }, { id: 'n', x: b.x + b.w/2 - hh, y: b.y - hh },
      { id: 'ne', x: b.x + b.w - hh, y: b.y - hh }, { id: 'e', x: b.x + b.w - hh, y: b.y + b.h/2 - hh },
      { id: 'se', x: b.x + b.w - hh, y: b.y + b.h - hh }, { id: 's', x: b.x + b.w/2 - hh, y: b.y + b.h - hh },
      { id: 'sw', x: b.x - hh, y: b.y + b.h - hh }, { id: 'w', x: b.x - hh, y: b.y + b.h/2 - hh },
    ];
    for (const p of positions) {
      if (imgX >= p.x - 4/state.zoom && imgX <= p.x + hs + 4/state.zoom &&
          imgY >= p.y - 4/state.zoom && imgY <= p.y + hs + 4/state.zoom) return p.id;
    }
    return null;
  }

  function isInsideLayer(layer, imgX, imgY) {
    const b = getLayerBounds(layer);
    return imgX >= b.x && imgX <= b.x + b.w && imgY >= b.y && imgY <= b.y + b.h;
  }

  // ============================================================
  //  LAYER MANAGEMENT
  // ============================================================
  function getActiveLayer() { return state.layers.find(l => l.id === state.activeLayerId) || null; }
  function setActiveLayer(id) {
    state.activeLayerId = id;
    updateLayerPanel();
    updateShapePropsVisibility();
    updateTextSectionVisibility();
    renderComposite();
  }
  function createLayer(type, opts) {
    const layer = {
      id: generateId(), name: opts.name || ('Capa ' + (state.layers.length + 1)), type, visible: true, locked: false,
      opacity: 1, x: opts.x || 0, y: opts.y || 0,
      width: opts.width != null ? opts.width : (type === 'raster' ? state.canvasWidth : (type === 'shape' ? 200 : undefined)),
      height: opts.height != null ? opts.height : (type === 'raster' ? state.canvasHeight : (type === 'shape' ? 200 : undefined)),
      content: null,
    };
    if (type === 'raster' && opts.fillColor) {
      layer.content = createSolidImageData(state.canvasWidth, state.canvasHeight, opts.fillColor.r, opts.fillColor.g, opts.fillColor.b, 255);
    }
    if (type === 'shape') {
      layer.shapeType = opts.shapeType || 'rect';
      layer.fillColor = opts.fillColor || '#6366f1';
      layer.cornerRadius = opts.cornerRadius || 0;
      layer.sides = opts.sides || (opts.shapeType === 'polygon' ? 5 : (opts.shapeType === 'star' ? 5 : 3));
    }
    if (type === 'text') {
      layer.text = opts.text || 'Texto';
      layer.fontSize = opts.fontSize || 48;
      layer.fontFamily = opts.fontFamily || 'Inter Tight';
      layer.fontWeight = opts.fontWeight || 'normal';
      layer.fontStyle = opts.fontStyle || 'normal';
      layer.textColor = opts.textColor || '#000000';
    }
    state.layers.push(layer); state.activeLayerId = layer.id;
    updateLayerPanel(); updateShapePropsVisibility(); updateTextSectionVisibility(); renderComposite(); return layer;
  }
  function deleteLayer(id) {
    if (state.layers.length <= 1) return;
    const l = state.layers.find(la => la.id === id);
    if (l && l.locked) return;
    const idx = state.layers.findIndex(la => la.id === id); if (idx === -1) return;
    state.layers.splice(idx, 1);
    if (state.activeLayerId === id) state.activeLayerId = state.layers[Math.min(idx, state.layers.length - 1)].id;
    updateLayerPanel(); updateShapePropsVisibility(); updateTextSectionVisibility(); renderComposite();
  }
  function duplicateLayer(id) {
    const idx = state.layers.findIndex(l => l.id === id); if (idx === -1) return;
    const orig = state.layers[idx];
    const dup = {
      id: generateId(), name: orig.name + ' copia', type: orig.type, visible: orig.visible,
      locked: false, opacity: orig.opacity, x: orig.x + 20, y: orig.y + 20,
      width: orig.width, height: orig.height, content: null,
    };
    if (orig.type === 'shape') {
      dup.shapeType = orig.shapeType; dup.fillColor = orig.fillColor;
      dup.cornerRadius = orig.cornerRadius; dup.sides = orig.sides;
    }
    if (orig.type === 'text') {
      dup.text = orig.text; dup.fontSize = orig.fontSize; dup.fontFamily = orig.fontFamily;
      dup.fontWeight = orig.fontWeight; dup.fontStyle = orig.fontStyle; dup.textColor = orig.textColor;
    }
    if (orig.content) {
      dup.content = new ImageData(new Uint8ClampedArray(orig.content.data), orig.content.width, orig.content.height);
    }
    state.layers.splice(idx + 1, 0, dup); state.activeLayerId = dup.id;
    updateLayerPanel(); updateShapePropsVisibility(); updateTextSectionVisibility(); renderComposite();
  }
  function reorderLayers(fromIdx, toIdx) {
    if (fromIdx === toIdx) return;
    const toLayer = state.layers[toIdx];
    if (toLayer && toLayer.locked) return;
    const fromLayer = state.layers[fromIdx];
    if (fromLayer && fromLayer.locked) return;
    const [m] = state.layers.splice(fromIdx, 1); state.layers.splice(toIdx, 0, m);
    updateLayerPanel(); renderComposite();
  }
  function mergeDownLayer(id) {
    const idx = state.layers.findIndex(l => l.id === id);
    if (idx <= 0 || idx >= state.layers.length) return;
    const top = state.layers[idx];
    const bot = state.layers[idx - 1];
    if (bot.locked || top.locked) return;
    if (top.type === 'text' || top.type === 'shape') {
      const tc = document.createElement('canvas'); tc.width = state.canvasWidth; tc.height = state.canvasHeight;
      const tctx = tc.getContext('2d');
      if (bot.content) { tctx.putImageData(bot.content, 0, 0); }
      if (top.type === 'text') {
        tctx.fillStyle = top.textColor || '#000';
        tctx.font = (top.fontStyle || 'normal') + ' ' + (top.fontWeight || 'normal') + ' ' + (top.fontSize || 48) + 'px "' + (top.fontFamily || 'Inter Tight') + '"';
        tctx.textBaseline = 'top';
        tctx.fillText(top.text || '', top.x, top.y);
      } else if (top.type === 'shape') {
        tctx.fillStyle = top.fillColor || '#6366f1';
        tctx.fillRect(top.x, top.y, top.width, top.height);
      }
      bot.content = tctx.getImageData(0, 0, state.canvasWidth, state.canvasHeight);
      state.layers.splice(idx, 1);
      state.activeLayerId = bot.id;
    } else if (top.content && bot.content) {
      const tc = document.createElement('canvas'); tc.width = state.canvasWidth; tc.height = state.canvasHeight;
      const tctx = tc.getContext('2d');
      tctx.putImageData(bot.content, 0, 0);
      let dw = top.width != null ? top.width : state.canvasWidth;
      let dh = top.height != null ? top.height : state.canvasHeight;
      tctx.drawImage(createImageFromData(top.content), top.x, top.y, dw, dh);
      bot.content = tctx.getImageData(0, 0, state.canvasWidth, state.canvasHeight);
      state.layers.splice(idx, 1);
      state.activeLayerId = bot.id;
    }
    updateLayerPanel(); updateShapePropsVisibility(); updateTextSectionVisibility(); renderComposite();
  }

  function createImageFromData(imgData) {
    const c = document.createElement('canvas'); c.width = imgData.width; c.height = imgData.height;
    c.getContext('2d').putImageData(imgData, 0, 0);
    return c;
  }

  // ============================================================
  //  SHAPE PROPERTIES SYNC
  // ============================================================
  function updateShapePropsVisibility() {
    const l = getActiveLayer();
    if (!l || l.type !== 'shape') {
      $shapePropsDyn.style.display = 'none';
      return;
    }
    $shapePropsDyn.style.display = 'block';
    $shapeColor.value = l.fillColor || '#6366f1';
    $shapeRadius.value = l.cornerRadius || 0;
    $shapeSides.value = l.sides || 5;
    $shapeSidesRow.style.display = (l.shapeType === 'polygon' || l.shapeType === 'star') ? 'flex' : 'none';
  }

  function syncShapeColor() {
    const l = getActiveLayer(); if (!l) return;
    if (l.type === 'shape') { l.fillColor = $shapeColor.value; renderComposite(); updateLayerPanel(); }
    if (l.type === 'text') { l.textColor = document.getElementById('text-color').value; renderComposite(); }
  }

  // ============================================================
  //  LAYER PANEL UI
  // ============================================================
  function updateLayerPanel() {
    $layersList.innerHTML = '';
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const layer = state.layers[i];
      const item = document.createElement('div');
      item.className = 'layer-item'; if (layer.id === state.activeLayerId) item.classList.add('selected');
      if (layer.locked) item.classList.add('locked');
      item.draggable = true; item.dataset.index = i; item.dataset.layerId = layer.id;

      const thumb = document.createElement('div'); thumb.className = 'layer-thumb';
      const tc = document.createElement('canvas'); tc.width = 36; tc.height = 36;
      const tctx = tc.getContext('2d');
      if (layer.type === 'raster' && layer.content) {
        const tmp = document.createElement('canvas'); tmp.width = state.canvasWidth; tmp.height = state.canvasHeight;
        tmp.getContext('2d').putImageData(layer.content, 0, 0); tctx.drawImage(tmp, 0, 0, 36, 36);
      } else if (layer.type === 'shape') {
        tctx.fillStyle = layer.fillColor || '#6366f1';
        tctx.fillRect(4, 8, 28, 20);
      } else if (layer.type === 'text') {
        tctx.fillStyle = '#666'; tctx.font = 'bold 14px "Inter Tight"'; tctx.textAlign = 'center'; tctx.fillText('T', 18, 24);
      }
      thumb.appendChild(tc); item.appendChild(thumb);

      const info = document.createElement('div'); info.className = 'layer-info';
      const nameEl = document.createElement('div'); nameEl.className = 'layer-name'; nameEl.textContent = layer.name;
      const typeEl = document.createElement('div'); typeEl.className = 'layer-type';
      if (layer.type === 'text') typeEl.textContent = 'Texto';
      else if (layer.type === 'shape') typeEl.textContent = 'Forma';
      else typeEl.textContent = layer.locked ? 'Fondo (bloqueado)' : 'Mapa de bits';
      info.appendChild(nameEl); info.appendChild(typeEl); item.appendChild(info);

      if (layer.locked) {
        const lockIcon = document.createElement('span');
        lockIcon.className = 'layer-lock-icon'; lockIcon.textContent = '\uD83D\uDD12';
        item.appendChild(lockIcon);
      }

      const visBtn = document.createElement('button'); visBtn.className = 'layer-vis-btn';
      if (!layer.visible) visBtn.classList.add('hidden');
      visBtn.innerHTML = layer.visible
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
      visBtn.title = layer.visible ? 'Ocultar' : 'Mostrar';
      visBtn.addEventListener('click', function(e) { e.stopPropagation(); layer.visible = !layer.visible; updateLayerPanel(); renderComposite(); });
      item.appendChild(visBtn);

      item.addEventListener('click', function() { setActiveLayer(layer.id); });
      if (!layer.locked) {
        item.addEventListener('dragstart', function(e) { e.dataTransfer.setData('text/plain', String(i)); e.dataTransfer.effectAllowed = 'move'; item.classList.add('dragging'); });
        item.addEventListener('dragend', function() { item.classList.remove('dragging'); document.querySelectorAll('.layer-item').forEach(el => el.classList.remove('drag-over')); });
        item.addEventListener('dragover', function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; item.classList.add('drag-over'); });
        item.addEventListener('dragleave', function() { item.classList.remove('drag-over'); });
        item.addEventListener('drop', function(e) {
          e.preventDefault(); item.classList.remove('drag-over');
          const fi = parseInt(e.dataTransfer.getData('text/plain'));
          if (fi !== i && !isNaN(fi)) reorderLayers(fi, i);
        });
      }
      $layersList.appendChild(item);
    }
  }

  function updateTextSectionVisibility() {
    const l = getActiveLayer();
    if (l && l.type === 'text') {
      $textPropsSection.style.display = 'block';
      document.getElementById('text-size').value = l.fontSize;
      document.getElementById('text-color').value = l.textColor;
      document.getElementById('text-font').value = l.fontFamily || 'Inter Tight';
      document.getElementById('text-bold').classList.toggle('active', l.fontWeight === 'bold');
      document.getElementById('text-italic').classList.toggle('active', l.fontStyle === 'italic');
      updateSizePresetsActive(l.fontSize);
      const body = document.getElementById('text-section-body');
      body.classList.remove('hidden');
      const header = document.querySelector('[data-section="text"]');
      if (header) header.classList.remove('collapsed');
    } else {
      $textPropsSection.style.display = 'block';
    }
  }

  function updateSizePresetsActive(size) {
    document.querySelectorAll('.size-preset').forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.size) === size);
    });
  }

  function updateToolUI() {
    document.querySelectorAll('.mini-tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === state.activeTool));
  }

  // ============================================================
  //  FIND LAYER AT POINT
  // ============================================================
  function findLayerAtPoint(ix, iy) {
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const l = state.layers[i]; if (!l.visible) continue;
      if (isInsideLayer(l, ix, iy)) return l;
    }
    return null;
  }
  function findTextLayerAtPoint(ix, iy) {
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const l = state.layers[i]; if (!l.visible || l.type !== 'text') continue;
      if (isInsideLayer(l, ix, iy)) return l;
    }
    return null;
  }

  // ============================================================
  //  CANVAS EVENT HANDLERS
  // ============================================================
  $canvas.addEventListener('mousedown', function(e) {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      state.isPanning = true;
      state.dragStartX = e.clientX - state.panX;
      state.dragStartY = e.clientY - state.panY;
      $canvas.style.cursor = 'grabbing'; e.preventDefault(); return;
    }
    const pos = canvasToImage(e.clientX, e.clientY);

    // Check resize handles first
    if (state.activeTool === 'move') {
      const al = getActiveLayer();
      if (al && al.visible && !al.locked) {
        const handle = findHandleAt(pos.x, pos.y, al);
        if (handle) {
          state.resizeHandle = handle;
          state.resizeStartX = pos.x; state.resizeStartY = pos.y;
          state.dragLayerOrigX = al.x; state.dragLayerOrigY = al.y;
          state.dragLayerOrigW = al.width != null ? al.width : (al.type === 'text' ? al.fontSize || 48 : (al.type === 'shape' ? 200 : state.canvasWidth));
          state.dragLayerOrigH = al.height != null ? al.height : (al.type === 'text' ? al.fontSize || 48 : (al.type === 'shape' ? 200 : state.canvasHeight));
          e.preventDefault(); return;
        }
      }
    }

    // Double-click for text
    if (state.activeTool === 'move' && e.detail === 2) {
      const textLayer = findTextLayerAtPoint(pos.x, pos.y);
      if (textLayer) {
        setActiveLayer(textLayer.id);
        openTextEditor(textLayer.x, textLayer.y, textLayer.text, textLayer.id);
        return;
      }
    }

    if (state.activeTool === 'move') { toolMoveDown(pos.x, pos.y, e); }
    else if (state.activeTool === 'text') { toolTextDown(pos.x, pos.y, e); }
  });

  $canvas.addEventListener('mousemove', function(e) {
    if (state.isPanning) {
      state.panX = e.clientX - state.dragStartX; state.panY = e.clientY - state.dragStartY;
      applyPanTransform(); return;
    }
    const pos = canvasToImage(e.clientX, e.clientY);

    if (state.resizeHandle) {
      const al = getActiveLayer(); if (!al || al.locked) return;
      const dx = pos.x - state.resizeStartX, dy = pos.y - state.resizeStartY;
      const isCorner = ['nw','ne','se','sw'].includes(state.resizeHandle);
      const origW = state.dragLayerOrigW, origH = state.dragLayerOrigH;
      const origX = state.dragLayerOrigX, origY = state.dragLayerOrigY;
      let nw = origW, nh = origH, nx = origX, ny = origY;
      const h = state.resizeHandle;
      if (h.includes('e')) { nw = origW + dx; }
      else if (h.includes('w')) { nw = origW - dx; nx = origX + dx; }
      if (h.includes('s')) { nh = origH + dy; }
      else if (h.includes('n')) { nh = origH - dy; ny = origY + dy; }
      if (isCorner && origW > 0 && origH > 0) {
        const scaleX = nw / origW, scaleY = nh / origH;
        const uniformScale = Math.max(scaleX, scaleY);
        nw = origW * uniformScale; nh = origH * uniformScale;
        if (h.includes('w')) nx = origX + origW - nw;
        if (h.includes('n')) ny = origY + origH - nh;
      }
      if (nw >= 1 && nh >= 1) {
        if (al.type === 'text') {
          const scaleFactor = nh / origH;
          al.fontSize = Math.max(1, Math.round(origH * scaleFactor));
          if (h.includes('w')) al.x = origX + (origW - origW * scaleFactor);
          if (h.includes('n')) al.y = origY + (origH - nh);
          if (state.activeLayerId === al.id) updateTextSectionVisibility();
        } else {
          al.width = nw; al.height = nh; al.x = nx; al.y = ny;
        }
        renderComposite();
      }
      return;
    }

    if (state.activeTool === 'move') toolMoveMove(pos.x, pos.y, e);

    if (state.activeTool === 'move' && !state.isDragging && !state.resizeHandle) {
      const al = getActiveLayer();
      if (al && al.visible && !al.locked) {
        const h = findHandleAt(pos.x, pos.y, al);
        const cursors = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
        $canvas.style.cursor = h ? (cursors[h] || 'default') : (findLayerAtPoint(pos.x, pos.y) ? 'grab' : 'default');
      } else {
        $canvas.style.cursor = 'default';
      }
    }
  });

  $canvas.addEventListener('mouseup', function(e) {
    if (state.isPanning) { state.isPanning = false; $canvas.style.cursor = 'default'; return; }
    if (state.resizeHandle) { state.resizeHandle = null; renderComposite(); return; }
    const pos = canvasToImage(e.clientX, e.clientY);
    if (state.activeTool === 'move') toolMoveUp(pos.x, pos.y, e);
  });

  $canvas.addEventListener('mouseleave', function() {
    state.isDragging = false; state.isPanning = false; state.isDrawingSelection = false; state.resizeHandle = null;
    $canvas.style.cursor = 'default';
  });

  $canvas.addEventListener('wheel', function(e) {
    if (e.shiftKey) { e.preventDefault(); state.panX -= e.deltaY; state.panX -= e.deltaX; applyPanTransform(); return; }
    if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAroundPoint(e.clientX, e.clientY, e.deltaY > 0 ? 0.9 : 1.1); renderComposite(); return; }
    e.preventDefault(); state.panY -= e.deltaY; state.panX -= e.deltaX; applyPanTransform();
  }, { passive: false });

  // ============================================================
  //  TOOL: MOVE
  // ============================================================
  function toolMoveDown(ix, iy, e) {
    const l = findLayerAtPoint(ix, iy);
    if (l && !l.locked) {
      setActiveLayer(l.id); state.isDragging = true;
      state.dragStartX = ix; state.dragStartY = iy;
      state.dragLayerOrigX = l.x; state.dragLayerOrigY = l.y;
      $canvas.style.cursor = 'grabbing';
    }
  }
  function toolMoveMove(ix, iy, e) {
    if (state.isDragging) {
      const l = getActiveLayer(); if (!l || l.locked) return;
      l.x = state.dragLayerOrigX + (ix - state.dragStartX);
      l.y = state.dragLayerOrigY + (iy - state.dragStartY);
      renderComposite();
    }
  }
  function toolMoveUp() { state.isDragging = false; $canvas.style.cursor = 'default'; }

  // ============================================================
  //  TOOL: TEXT
  // ============================================================
  function toolTextDown(ix, iy) {
    if (state.isEditingText) commitText();
    const exist = findTextLayerAtPoint(ix, iy);
    if (exist) { setActiveLayer(exist.id); openTextEditor(exist.x, exist.y, exist.text, exist.id); }
    else {
      const layer = createLayer('text', { name: 'Texto', x: ix, y: iy, text: 'Texto', fontSize: 48, fontFamily: 'Inter Tight', textColor: '#000000' });
      openTextEditor(ix, iy, 'Texto', layer.id);
    }
  }

  function openTextEditor(x, y, txt, layerId) {
    const r = $canvas.getBoundingClientRect();
    $textOverlay.style.display = 'block'; $textOverlay.classList.add('active');
    $textOverlay.style.left = (r.left + x * state.zoom) + 'px';
    $textOverlay.style.top = (r.top + y * state.zoom) + 'px';
    const l = state.layers.find(la => la.id === layerId);
    const fs = l && l.type === 'text' ? (l.fontSize || 48) : 48;
    const ff = l && l.type === 'text' ? (l.fontFamily || 'Inter Tight') : 'Inter Tight';
    const fc = l && l.type === 'text' ? (l.textColor || '#000') : '#000';
    const fw = l && l.type === 'text' ? (l.fontWeight || 'normal') : 'normal';
    const fst = l && l.type === 'text' ? (l.fontStyle || 'normal') : 'normal';
    $textInput.value = txt || '';
    $textInput.style.fontSize = fs + 'px';
    $textInput.style.fontFamily = ff;
    $textInput.style.color = fc;
    $textInput.style.fontWeight = fw;
    $textInput.style.fontStyle = fst;
    $textInput.focus();
    $textInput.select();
    state.isEditingText = true; state._pendingTextX = x; state._pendingTextY = y;
    state._editingLayerId = layerId;
  }

  function commitText() {
    const txt = $textInput.value.trim();
    $textOverlay.style.display = 'none'; $textOverlay.classList.remove('active');
    if (txt && state._editingLayerId) {
      const l = state.layers.find(x => x.id === state._editingLayerId);
      if (l && l.type === 'text') { l.text = txt; l.name = txt.substring(0, 20); updateLayerPanel(); updateTextSectionVisibility(); renderComposite(); }
    }
    state.isEditingText = false;
    state._editingLayerId = null;
    updateTextSectionVisibility();
  }

  function cancelText() {
    $textOverlay.style.display = 'none'; $textOverlay.classList.remove('active');
    if (state._editingLayerId) {
      const l = state.layers.find(x => x.id === state._editingLayerId);
      if (l && l.type === 'text' && l.text === 'Texto') {
        deleteLayer(l.id);
      }
    }
    state.isEditingText = false; state._editingLayerId = null;
  }

  // ============================================================
  //  BUTTONS & EVENTS
  // ============================================================
  document.querySelectorAll('.mini-tool-btn[data-tool]').forEach(b => {
    b.addEventListener('click', function() {
      if (state.isEditingText) commitText();
      state.activeTool = this.dataset.tool;
      updateToolUI();
      $canvas.style.cursor = state.activeTool === 'text' ? 'crosshair' : 'default';
      renderComposite();
    });
  });

  // Shape buttons
  document.querySelectorAll('.shape-btn').forEach(b => {
    b.addEventListener('click', function() {
      const shapeType = this.dataset.shape;
      const fillColor = $shapeColor.value || '#6366f1';
      const cx = Math.round(state.canvasWidth / 4);
      const cy = Math.round(state.canvasHeight / 4);
      const defaultSides = shapeType === 'star' ? 5 : (shapeType === 'polygon' ? 5 : 3);
      createLayer('shape', {
        name: shapeType === 'polygon' ? 'Poligono' : (shapeType.charAt(0).toUpperCase() + shapeType.slice(1)),
        shapeType: shapeType,
        fillColor: fillColor,
        cornerRadius: 0,
        sides: defaultSides,
        x: cx, y: cy,
        width: shapeType === 'line' ? 200 : 200,
        height: shapeType === 'line' ? 4 : 200
      });
    });
  });

  // Shape properties - real-time
  $shapeColor.addEventListener('input', syncShapeColor);
  $shapeRadius.addEventListener('input', function() {
    const l = getActiveLayer(); if (l && l.type === 'shape') { l.cornerRadius = parseInt(this.value) || 0; renderComposite(); }
  });
  $shapeSides.addEventListener('input', function() {
    const l = getActiveLayer(); if (l && l.type === 'shape') { l.sides = clamp(parseInt(this.value) || 3, 3, 16); renderComposite(); }
  });

  // Text properties - real-time
  document.getElementById('text-color').addEventListener('input', syncShapeColor);

  document.getElementById('btn-new-layer').addEventListener('click', function() { createLayer('raster', { name: 'Capa ' + state.layers.length }); });
  document.getElementById('btn-delete-layer').addEventListener('click', function() { const l = getActiveLayer(); if (l) deleteLayer(l.id); });
  document.getElementById('btn-duplicate-layer').addEventListener('click', function() { const l = getActiveLayer(); if (l) duplicateLayer(l.id); });
  document.getElementById('btn-merge-layer').addEventListener('click', function() { const l = getActiveLayer(); if (l) mergeDownLayer(l.id); });
  document.getElementById('btn-back').addEventListener('click', function() { if (state.isEditingText) commitText(); showLanding(); });

  // Zoom
  document.getElementById('btn-zoom-in').addEventListener('click', function() {
    const cr = $canvasContainer.getBoundingClientRect();
    zoomAroundPoint(cr.left + cr.width/2, cr.top + cr.height/2, 1.25); renderComposite();
  });
  document.getElementById('btn-zoom-out').addEventListener('click', function() {
    const cr = $canvasContainer.getBoundingClientRect();
    zoomAroundPoint(cr.left + cr.width/2, cr.top + cr.height/2, 0.8); renderComposite();
  });
  document.getElementById('btn-zoom-fit').addEventListener('click', function() { fitCanvas(); renderComposite(); });

  // Text overlay
  $textInput.addEventListener('input', function() {
    if (state._editingLayerId) {
      const l = state.layers.find(x => x.id === state._editingLayerId);
      if (l && l.type === 'text') { l.text = $textInput.value || 'Texto'; renderComposite(); }
    }
  });
  $textInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitText(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelText(); }
  });
  $textInput.addEventListener('blur', function() {
    setTimeout(function() { if (state.isEditingText) commitText(); }, 100);
  });

  // Color picker
  $colorPicker.addEventListener('click', function(e) { e.stopPropagation(); toggleColorWheel(); });
  document.addEventListener('click', function(e) {
    if ($colorPopup.style.display === 'block' && !$colorPopup.contains(e.target) && e.target !== $colorPicker && !$colorPicker.contains(e.target)) {
      $colorPopup.style.display = 'none';
    }
  });

  // Color wheel
  $colorCanvas.addEventListener('mousedown', function(e) {
    const r = $colorCanvas.getBoundingClientRect(); pickColorFromWheel(e.clientX - r.left, e.clientY - r.top);
  });
  $colorCanvas.addEventListener('mousemove', function(e) {
    if (e.buttons === 1) { const r = $colorCanvas.getBoundingClientRect(); pickColorFromWheel(e.clientX - r.left, e.clientY - r.top); }
  });
  $cwBrightness.addEventListener('input', function() { state.wheelBri = parseInt(this.value)||100; applyWheelColor(); });
  document.getElementById('cw-apply').addEventListener('click', function() { applyWheelColor(); $colorPopup.style.display = 'none'; });
  $cwHex.addEventListener('input', function() {
    const hex = this.value; if (/^#[0-9a-fA-F]{6}$/.test(hex)) { const rgb = hexToRgb(hex); state.brushColor = rgb; updateColorUI(); }
  });
  $cwHex.addEventListener('keydown', function(e) { if (e.key === 'Enter') { applyWheelColor(); $colorPopup.style.display = 'none'; } });

  // Text properties
  document.getElementById('text-size').addEventListener('input', function() {
    const l = getActiveLayer(); if (l && l.type === 'text') { l.fontSize = parseInt(this.value)||48; updateSizePresetsActive(l.fontSize); renderComposite(); }
  });
  document.getElementById('text-font').addEventListener('change', function() {
    const l = getActiveLayer(); if (l && l.type === 'text') { l.fontFamily = this.value; renderComposite(); }
  });
  document.getElementById('text-bold').addEventListener('click', function() {
    const l = getActiveLayer(); if (l && l.type === 'text') { l.fontWeight = l.fontWeight === 'bold' ? 'normal' : 'bold'; this.classList.toggle('active', l.fontWeight === 'bold'); renderComposite(); }
  });
  document.getElementById('text-italic').addEventListener('click', function() {
    const l = getActiveLayer(); if (l && l.type === 'text') { l.fontStyle = l.fontStyle === 'italic' ? 'normal' : 'italic'; this.classList.toggle('active', l.fontStyle === 'italic'); renderComposite(); }
  });

  // Size presets
  document.querySelectorAll('.size-preset').forEach(b => {
    b.addEventListener('click', function() {
      const l = getActiveLayer(); if (l && l.type === 'text') {
        const size = parseInt(this.dataset.size);
        l.fontSize = size;
        document.getElementById('text-size').value = size;
        updateSizePresetsActive(size);
        renderComposite();
      }
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (state.screen !== 'editor') return;
    const tag = document.activeElement.tagName.toLowerCase();
    if ((tag === 'input' || tag === 'textarea') && document.activeElement !== $textInput) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'j') { e.preventDefault(); const l = getActiveLayer(); if (l) duplicateLayer(l.id); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') { e.preventDefault(); const l = getActiveLayer(); if (l) mergeDownLayer(l.id); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && tag !== 'input' && tag !== 'textarea') { e.preventDefault(); const l = getActiveLayer(); if (l && state.layers.length > 1 && !l.locked) deleteLayer(l.id); return; }
    if (tag !== 'input' && tag !== 'textarea') {
      if (e.key === 'v' || e.key === 'V') { state.activeTool = 'move'; updateToolUI(); $canvas.style.cursor = 'default'; renderComposite(); }
      else if (e.key === 't' || e.key === 'T') { state.activeTool = 'text'; updateToolUI(); $canvas.style.cursor = 'crosshair'; renderComposite(); }
      else if (e.key === 'Escape') { state.selection = null; state.resizeHandle = null; if (state.isEditingText) cancelText(); renderComposite(); }
    }
  });

  window.addEventListener('resize', function() { if (state.screen === 'editor') renderComposite(); });

  // ============================================================
  //  INIT
  // ============================================================
  initSidebarSections();
  initModal();
  initLanding();
  updateColorUI();
})();
