import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import {
  generateId, clamp, hslToRgb, rgbToHex, hexToRgb,
  createSolidImageData, renderShapeLayer, getLayerBounds, isInsideLayer,
  sanitizeText, sanitizeSVG,
} from './utils/canvas';
import { jsPDF } from 'jspdf';

// ============================================================
const FONTS = ['Inter Tight','Roboto','Open Sans','Montserrat','Playfair Display','Poppins','Lato','Raleway','Merriweather','Nunito'];
const PRESET_SIZES = [['9:16',1080,1920],['16:9',1920,1080],['1:1 HD',1080,1080],['1:1 FHD',1920,1920],['Poster',2480,3508]];

function createDefaultSlide(w, h, bg) {
  const bgId = generateId();
  const layers = [{
    id: bgId, name:'Fondo', type:'raster', visible:true, locked:true, opacity:1,
    x:0, y:0, width:w, height:h,
    content: bg==='white' ? createSolidImageData(w,h,255,255,255,255) : null,
  }];
  return { id: generateId(), width:w, height:h, backgroundColor:bg, layers, activeLayerId: bgId };
}

// ============================================================
function App() {
  const [screen, setScreen] = useState('landing');
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  // Project config
  const [projW, setProjW] = useState(1920);
  const [projH, setProjH] = useState(1080);
  const [activePreset, setActivePreset] = useState(1);

  // Slides
  const [slides, setSlides] = useState(() => [createDefaultSlide(1920,1080,'white')]);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);

  const activeSlide = slides[activeSlideIdx];
  const layers = activeSlide?.layers || [];
  const activeLayerId = activeSlide?.activeLayerId || null;

  // Editor tools
  const [activeTool, setActiveTool] = useState('move');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x:0, y:0 });
  const [showColorPopup, setShowColorPopup] = useState(false);
  const [brushColor, setBrushColor] = useState({ r:99, g:102, b:241 });
  const [wheelHSL, setWheelHSL] = useState({ h:0, s:0, bri:100 });
  const [editingText, setEditingText] = useState(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, layer }
  const [projectName, setProjectName] = useState('Sin titulo');
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [mobileTools, setMobileTools] = useState(false);

  // Refs
  const canvasRef = useRef(null);
  const canvasWrapperRef = useRef(null);
  const containerRef = useRef(null);
  const colorWheelRef = useRef(null);
  const renderScheduled = useRef(false);
  const offscreenRef = useRef(null);
  const checkerRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const panRef = useRef(null);
  const wheelCache = useRef(null);
  const histRef = useRef({ undo: [], redo: [] });
  const slidesRef = useRef(slides);
  useEffect(() => { slidesRef.current = slides; }, [slides]);

  // ---- History ----
  const pushHistory = useCallback(() => {
    try {
      const snap = structuredClone(slidesRef.current);
      histRef.current.undo.push(snap);
      if (histRef.current.undo.length > 20) histRef.current.undo.shift();
      histRef.current.redo = [];
    } catch(e) { /* ignore clone errors */ }
  }, []);

  const undo = useCallback(() => {
    if (histRef.current.undo.length === 0) return;
    try {
      const snap = structuredClone(slidesRef.current);
      histRef.current.redo.push(snap);
      if (histRef.current.redo.length > 20) histRef.current.redo.shift();
      setSlides(histRef.current.undo.pop());
      setActiveSlideIdx(0);
    } catch(e) {}
  }, []);

  const redo = useCallback(() => {
    if (histRef.current.redo.length === 0) return;
    try {
      const snap = structuredClone(slidesRef.current);
      histRef.current.undo.push(snap);
      if (histRef.current.undo.length > 20) histRef.current.undo.shift();
      setSlides(histRef.current.redo.pop());
      setActiveSlideIdx(0);
    } catch(e) {}
  }, []);

  // ---- Helpers ----
  const getActiveLayer = useCallback(() => {
    return layers.find(l => l.id === activeLayerId) || null;
  }, [layers, activeLayerId]);

  const updateSlide = useCallback((updater) => {
    setSlides(prev => prev.map((s, i) => i === activeSlideIdx ? updater(s) : s));
  }, [activeSlideIdx]);

  const setActiveLayerId = useCallback((id) => {
    updateSlide(s => ({ ...s, activeLayerId: id }));
  }, [updateSlide]);

  // ---- Render (optimized with rAF) ----
  const renderComposite = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const slide = slides[activeSlideIdx];
    if (!slide) return;
    const w = slide.width, h = slide.height;

    // Cached checkerboard
    if (!checkerRef.current || checkerRef.current.width !== w || checkerRef.current.height !== h) {
      const cc = document.createElement('canvas'); cc.width = w; cc.height = h;
      const cctx = cc.getContext('2d');
      const sCh = 12;
      for (let y = 0; y < h; y += sCh)
        for (let x = 0; x < w; x += sCh)
          cctx.fillStyle = ((x/sCh + y/sCh) % 2 === 0) ? '#d8d8d8' : '#ccc', cctx.fillRect(x, y, sCh, sCh);
      checkerRef.current = cc;
    }
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(checkerRef.current, 0, 0);

    // Reusable offscreen canvas
    if (!offscreenRef.current || offscreenRef.current.width !== w || offscreenRef.current.height !== h) {
      offscreenRef.current = document.createElement('canvas');
      offscreenRef.current.width = w; offscreenRef.current.height = h;
    }
    const offCtx = offscreenRef.current.getContext('2d');

    for (const layer of slide.layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      if (layer.type === 'raster' && layer.content) {
        const iw = layer.content.width, ih = layer.content.height;
        if (offscreenRef.current.width !== iw || offscreenRef.current.height !== ih) {
          offscreenRef.current.width = iw; offscreenRef.current.height = ih;
        }
        offCtx.putImageData(layer.content, 0, 0);
        const dw = layer.width != null ? layer.width : w;
        const dh = layer.height != null ? layer.height : h;
        ctx.drawImage(offscreenRef.current, 0, 0, iw, ih, layer.x, layer.y, dw, dh);
      } else if (layer.type === 'shape') {
        renderShapeLayer(ctx, layer);
      } else if (layer.type === 'text') {
        if (editingText && layer.id === editingText.layerId) { ctx.restore(); continue; }
        ctx.fillStyle = layer.textColor || '#000';
        const weight = layer.fontWeight || 'normal';
        const style = layer.fontStyle || 'normal';
        const size = layer.fontSize || 48;
        const fam = layer.fontFamily || 'Inter Tight';
        ctx.font = style + ' ' + weight + ' ' + size + 'px "' + fam + '"';
        ctx.textBaseline = 'top';
        ctx.fillText(layer.text || '', layer.x, layer.y);
      }
      ctx.restore();
    }

    const al = slide.layers.find(l => l.id === slide.activeLayerId);
    if (al && al.visible && !al.locked && activeTool === 'move' && !(dragRef.current)) {
      drawResizeHandles(ctx, al, slide.width, slide.height);
    }
  }, [slides, activeSlideIdx, activeTool, editingText]);

  const scheduleRender = useCallback(() => {
    if (!renderScheduled.current) {
      renderScheduled.current = true;
      requestAnimationFrame(() => {
        renderScheduled.current = false;
        renderComposite();
      });
    }
  }, [renderComposite]);

  // Execute render synchronously after state changes (before paint)
  useLayoutEffect(() => { renderComposite(); }, [renderComposite]);

  // ---- Resize handles ----
  function drawResizeHandles(ctx, layer, cw, ch) {
    const b = getLayerBounds(layer, cw, ch);
    const hs = 8 / zoom, hh = hs / 2;
    const pos = [
      {id:'nw', x:b.x-hh, y:b.y-hh},{id:'n', x:b.x+b.w/2-hh, y:b.y-hh},
      {id:'ne', x:b.x+b.w-hh, y:b.y-hh},{id:'e', x:b.x+b.w-hh, y:b.y+b.h/2-hh},
      {id:'se', x:b.x+b.w-hh, y:b.y+b.h-hh},{id:'s', x:b.x+b.w/2-hh, y:b.y+b.h-hh},
      {id:'sw', x:b.x-hh, y:b.y+b.h-hh},{id:'w', x:b.x-hh, y:b.y+b.h/2-hh},
    ];
    ctx.save();
    for (const p of pos) {
      const isC = ['nw','ne','se','sw'].includes(p.id);
      ctx.fillStyle = isC ? '#6366f1' : '#666';
      ctx.fillRect(p.x, p.y, hs, hs);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1/zoom; ctx.strokeRect(p.x, p.y, hs, hs);
    }
    // Center point
    const cs = 10 / zoom;
    ctx.fillStyle = '#6366f1';
    ctx.beginPath(); ctx.arc(b.x + b.w/2, b.y + b.h/2, cs, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5/zoom; ctx.stroke();
    ctx.restore();
  }

  function findHandle(imgX, imgY, layer, cw, ch) {
    const b = getLayerBounds(layer, cw, ch);
    const hs = 8 / zoom, hh = hs / 2;
    const pos = [
      {id:'nw', x:b.x-hh, y:b.y-hh},{id:'n', x:b.x+b.w/2-hh, y:b.y-hh},
      {id:'ne', x:b.x+b.w-hh, y:b.y-hh},{id:'e', x:b.x+b.w-hh, y:b.y+b.h/2-hh},
      {id:'se', x:b.x+b.w-hh, y:b.y+b.h-hh},{id:'s', x:b.x+b.w/2-hh, y:b.y+b.h-hh},
      {id:'sw', x:b.x-hh, y:b.y+b.h-hh},{id:'w', x:b.x-hh, y:b.y+b.h/2-hh},
    ];
    for (const p of pos) {
      if (imgX >= p.x - 4/zoom && imgX <= p.x + hs + 4/zoom &&
          imgY >= p.y - 4/zoom && imgY <= p.y + hs + 4/zoom) return p.id;
    }
    // Center point
    const cr = 12 / zoom;
    const cx = b.x + b.w/2, cy = b.y + b.h/2;
    if (Math.hypot(imgX - cx, imgY - cy) <= cr) return 'center';
    return null;
  }

  // ---- Canvas mouse events ----
  const canvasToImg = useCallback((cx, cy) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return { x:0, y:0 };
    return { x: (cx - r.left) / zoom, y: (cy - r.top) / zoom };
  }, [zoom]);

  const handleCanvasDown = useCallback((e) => {
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      panRef.current = { sx: e.clientX - pan.x, sy: e.clientY - pan.y };
      return;
    }
    const pos = canvasToImg(e.clientX, e.clientY);
    const slide = slides[activeSlideIdx];
    const al = slide.layers.find(l => l.id === slide.activeLayerId);

    // Resize handle check
    if (activeTool === 'move' && al && al.visible && !al.locked) {
      const h = findHandle(pos.x, pos.y, al, slide.width, slide.height);
      if (h) {
        if (h === 'center') {
          // Center point drag = move
          setActiveLayerId(al.id);
          dragRef.current = { sx: pos.x, sy: pos.y, ox: al.x, oy: al.y };
          return;
        }
        resizeRef.current = {
          handle: h, sx: pos.x, sy: pos.y,
          ox: al.x, oy: al.y,
          ow: al.width != null ? al.width : (al.type==='text'?al.fontSize||48:200),
          oh: al.height != null ? al.height : (al.type==='text'?al.fontSize||48:200),
        };
        return;
      }
    }

    // Double-click text
    if (activeTool === 'move' && e.detail === 2) {
      const txtLayer = [...slide.layers].reverse().find(l => l.type==='text' && l.visible && isInsideLayer(l, pos.x, pos.y, slide.width, slide.height));
      if (txtLayer) {
        setActiveLayerId(txtLayer.id);
        setEditingText({ layerId: txtLayer.id, x: txtLayer.x, y: txtLayer.y, text: txtLayer.text });
        return;
      }
    }

    if (activeTool === 'move') {
      const l = [...slide.layers].reverse().find(l => l.visible && !l.locked && isInsideLayer(l, pos.x, pos.y, slide.width, slide.height));
      if (l) {
        setActiveLayerId(l.id);
        dragRef.current = { sx: pos.x, sy: pos.y, ox: l.x, oy: l.y };
      }
    } else if (activeTool === 'text') {
      // Commit any pending text edit first
      const wasEditing = !!editingText;
      if (editingText) {
        const txt = document.getElementById('text-editor-input')?.value?.trim();
        if (txt) {
          updateSlide(s => ({ ...s, layers: s.layers.map(l => l.id===editingText.layerId ? {...l, text: txt, name: txt.substring(0,20)} : l) }));
        }
        setEditingText(null);
      }
      // Check non-text layers -> select + switch to move
      const anyLayer = [...slide.layers].reverse().find(l => l.visible && !l.locked && l.type !== 'text' && isInsideLayer(l, pos.x, pos.y, slide.width, slide.height));
      if (anyLayer) {
        setActiveTool('move');
        setActiveLayerId(anyLayer.id);
        return;
      }
      // Check existing text layer -> select + switch to move
      const exist = [...slide.layers].reverse().find(l => l.type==='text' && l.visible && isInsideLayer(l, pos.x, pos.y, slide.width, slide.height));
      if (exist) {
        setActiveTool('move');
        setActiveLayerId(exist.id);
        return;
      }
      // If user was just editing and clicked empty space, just commit, don't create new
      if (wasEditing) return;
      // Empty space -> create text layer and open editor immediately
      const layer = { id: generateId(), name:'', type:'text', visible:true, locked:false, opacity:1, x:pos.x, y:pos.y, text:'', fontSize:48, fontFamily:'Inter Tight', fontWeight:'normal', fontStyle:'normal', textColor:'#000000' };
      updateSlide(s => ({ ...s, layers: [...s.layers, layer], activeLayerId: layer.id }));
      setEditingText({ layerId: layer.id, x: pos.x, y: pos.y, text: '' });
    } else if (activeTool === 'image') {
      if (editingText) { setEditingText(null); }
      document.getElementById('image-file-input')?.click();
    }

  }, [activeTool, activeSlideIdx, slides, pan, editingText, canvasToImg, setActiveLayerId, updateSlide, pushHistory]);

  const handleCanvasMove = useCallback((e) => {
    if (panRef.current) {
      setPan({ x: e.clientX - panRef.current.sx, y: e.clientY - panRef.current.sy });
      return;
    }
    const pos = canvasToImg(e.clientX, e.clientY);
    const slide = slides[activeSlideIdx];

    if (resizeRef.current) {
      const r = resizeRef.current;
      const al = slide.layers.find(l => l.id === slide.activeLayerId);
      if (!al) return;
      const dx = pos.x - r.sx, dy = pos.y - r.sy;
      let nw = r.ow, nh = r.oh, nx = r.ox, ny = r.oy;
      const h = r.handle;
      if (h.includes('e')) nw = r.ow + dx;
      else if (h.includes('w')) { nw = r.ow - dx; nx = r.ox + dx; }
      if (h.includes('s')) nh = r.oh + dy;
      else if (h.includes('n')) { nh = r.oh - dy; ny = r.oy + dy; }
      if (['nw','ne','se','sw'].includes(h) && r.ow > 0 && r.oh > 0) {
        const s = Math.max(nw/r.ow, nh/r.oh);
        nw = r.ow * s; nh = r.oh * s;
        if (h.includes('w')) nx = r.ox + r.ow - nw;
        if (h.includes('n')) ny = r.oy + r.oh - nh;
      }
      if (nw >= 1 && nh >= 1) {
        updateSlide(s => {
          const newLayers = s.layers.map(l => {
            if (l.id !== s.activeLayerId) return l;
            if (l.type === 'text') {
              const scale = nh / r.oh;
              return { ...l, fontSize: Math.max(1, Math.round(r.oh * scale)), x: h.includes('w') ? r.ox + (r.ow - r.ow*scale) : l.x, y: h.includes('n') ? r.oy + (r.oh - nh) : l.y };
            }
            return { ...l, width: nw, height: nh, x: nx, y: ny };
          });
          return { ...s, layers: newLayers };
        });
      }
      return;
    }

    if (dragRef.current) {
      const d = dragRef.current;
      updateSlide(s => {
        const newLayers = s.layers.map(l => {
          if (l.id !== s.activeLayerId || l.locked) return l;
          return { ...l, x: d.ox + (pos.x - d.sx), y: d.oy + (pos.y - d.sy) };
        });
        return { ...s, layers: newLayers };
      });
    }
  }, [activeSlideIdx, slides, canvasToImg, updateSlide]);

  const handleCanvasUp = useCallback(() => {
    panRef.current = null;
    if (resizeRef.current) { resizeRef.current = null; }
    if (dragRef.current) { dragRef.current = null; }
    scheduleRender();
  }, [scheduleRender]);

  // ---- Layer operations ----
  const createLayer = useCallback((type, opts) => {
    pushHistory();
    updateSlide(s => {
      const layer = {
        id: generateId(), name: opts.name || ('Capa ' + (s.layers.length+1)), type, visible:true, locked:false, opacity:1,
        x: opts.x||0, y: opts.y||0,
        width: opts.width, height: opts.height, content: null,
      };
      if (type==='raster' && opts.fillColor) layer.content = createSolidImageData(s.width, s.height, opts.fillColor.r, opts.fillColor.g, opts.fillColor.b, 255);
      if (type==='shape') { layer.shapeType = opts.shapeType||'rect'; layer.fillColor = opts.fillColor||'#6366f1'; layer.cornerRadius = opts.cornerRadius||0; layer.sides = opts.sides||5; }
      if (type==='text') { layer.text = opts.text||'Texto'; layer.fontSize = opts.fontSize||48; layer.fontFamily = opts.fontFamily||'Inter Tight'; layer.fontWeight = opts.fontWeight||'normal'; layer.fontStyle = opts.fontStyle||'normal'; layer.textColor = opts.textColor||'#000000'; }
      return { ...s, layers: [...s.layers, layer], activeLayerId: layer.id };
    });
  }, [updateSlide]);

  const deleteLayer = useCallback((id) => {
    pushHistory();
    updateSlide(s => {
      if (s.layers.length <= 1) return s;
      const l = s.layers.find(la => la.id === id);
      if (l?.locked) return s;
      const idx = s.layers.findIndex(la => la.id === id);
      if (idx === -1) return s;
      const newLayers = s.layers.filter(la => la.id !== id);
      const newActive = s.activeLayerId === id ? newLayers[Math.min(idx, newLayers.length-1)]?.id : s.activeLayerId;
      return { ...s, layers: newLayers, activeLayerId: newActive };
    });
  }, [updateSlide]);

  const duplicateLayer = useCallback((id) => {
    pushHistory();
    updateSlide(s => {
      const idx = s.layers.findIndex(l => l.id === id);
      if (idx === -1) return s;
      const orig = s.layers[idx];
      const dup = { id: generateId(), name: orig.name + ' copia', type: orig.type, visible: orig.visible, locked: false, opacity: orig.opacity, x: orig.x+20, y: orig.y+20, width: orig.width, height: orig.height, content: null };
      ['shapeType','fillColor','cornerRadius','sides','text','fontSize','fontFamily','fontWeight','fontStyle','textColor'].forEach(k => { if (orig[k] != null) dup[k] = orig[k]; });
      if (orig.content) dup.content = new ImageData(new Uint8ClampedArray(orig.content.data), orig.content.width, orig.content.height);
      const newLayers = [...s.layers]; newLayers.splice(idx+1, 0, dup);
      return { ...s, layers: newLayers, activeLayerId: dup.id };
    });
  }, [updateSlide]);

  // ---- Text editing ----
  const commitText = useCallback(() => {
    if (!editingText) return;
    const raw = sanitizeText(document.getElementById('text-editor-input')?.value || '');
    const txt = raw.trimEnd();
    updateSlide(s => ({ ...s, layers: s.layers.map(l => l.id===editingText.layerId ? {...l, text: txt, name: txt.substring(0,20) || 'Texto'} : l) }));
    setEditingText(null);
  }, [editingText, updateSlide]);

  const cancelText = useCallback(() => {
    if (!editingText) return;
    pushHistory();
    updateSlide(s => {
      const l = s.layers.find(x => x.id === editingText.layerId);
      // Always delete empty text layers on Escape, keep non-empty ones
      if (l && l.type==='text' && (!l.text || l.text === '')) {
        return { ...s, layers: s.layers.filter(x => x.id !== editingText.layerId), activeLayerId: s.layers[0]?.id };
      }
      return s;
    });
    setEditingText(null);
  }, [editingText, updateSlide]);

  // ---- Layer reorder (drag & drop) ----
  const reorderLayers = useCallback((fromIdx, toIdx) => {
    pushHistory();
    updateSlide(s => {
      if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return s;
      if (s.layers[toIdx]?.locked || s.layers[fromIdx]?.locked) return s;
      const arr = [...s.layers];
      const [m] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, m);
      return { ...s, layers: arr };
    });
  }, [updateSlide]);

  // ---- Image import ----
  const importImage = useCallback((img) => {
    const slide = slides[activeSlideIdx];
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0);
    const layer = {
      id: generateId(), name: 'Imagen', type: 'raster', visible: true, locked: false, opacity: 1, isImage: true,
      x: 0, y: 0, width: w, height: h,
      content: c.getContext('2d').getImageData(0, 0, w, h)
    };
    updateSlide(s => ({ ...s, layers: [...s.layers, layer], activeLayerId: layer.id }));
    setActiveTool('move');
  }, [slides, activeSlideIdx, updateSlide]);

  const handleImageFile = useCallback((file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => importImage(img);
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, [importImage]);

  // ---- SVG import ----
  const importSVG = useCallback((svgPath, color) => {
    fetch(svgPath).then(r => r.text()).then(svgText => {
      let fixed = svgText;
      if (!fixed.includes('width=')) fixed = fixed.replace('<svg', '<svg width="200" height="200"');
      const colored = sanitizeSVG(fixed).replace(/currentColor/g, color || '#6366f1');
      const blob = new Blob([colored], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { importImage(img); URL.revokeObjectURL(url); };
      img.onerror = () => { URL.revokeObjectURL(url); };
      img.src = url;
    }).catch(() => {});
  }, [importImage]);

  // ---- Slides ----
  const addSlide = useCallback(() => {
    const w = slides[0]?.width || 1920;
    const h = slides[0]?.height || 1080;
    setSlides(prev => [...prev, createDefaultSlide(w, h, 'white')]);
    setActiveSlideIdx(prev => prev + 1);
  }, [slides]);

  // ---- Create project ----
  const createProject = useCallback(() => {
    setShowModal(false);
    setLoading(true);
    setTimeout(() => {
      const s = createDefaultSlide(projW, projH, 'white');
      setSlides([s]);
      setActiveSlideIdx(0);
      setScreen('editor');
      setTimeout(() => setLoading(false), 400);
    }, 80);
  }, [projW, projH]);

  // ---- Fit canvas ----
  const fitCanvas = useCallback(() => {
    if (!containerRef.current) return;
    const cw = containerRef.current.clientWidth - 32;
    const ch = containerRef.current.clientHeight - 32;
    const s = slides[activeSlideIdx];
    if (!s) return;
    const z = Math.min(cw / s.width, ch / s.height, 1);
    setZoom(z); setPan({ x:0, y:0 });
  }, [slides, activeSlideIdx]);

  useEffect(() => {
    if (screen === 'editor') { fitCanvas(); }
  }, [screen, fitCanvas]);

  // ---- Zoom/Pan ----
  const applyZoom = useCallback((factor, sx, sy) => {
    const r = canvasRef.current?.getBoundingClientRect();
    if (!r) return;
    const mx = sx - r.left, my = sy - r.top;
    const oldZ = zoom;
    const ix = mx / oldZ, iy = my / oldZ;
    const z = clamp(oldZ * factor, 0.05, 32);
    setZoom(z);
    setPan(p => ({ x: p.x + ix * (oldZ - z), y: p.y + iy * (oldZ - z) }));
  }, [zoom]);

  // ---- Theme ----
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  // Close export menu on outside click
  const exportRef = useRef(null);
  useEffect(() => {
    if (!showExportMenu) return;
    const h = (e) => { if (exportRef.current && !exportRef.current.contains(e.target)) setShowExportMenu(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showExportMenu]);

  // ---- Keyboard ----
  useEffect(() => {
    const handler = (e) => {
      if (screen !== 'editor') return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if ((tag === 'input' || tag === 'textarea') && document.activeElement !== document.getElementById('text-editor-input')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          const al = layers.find(l => l.id === activeLayerId);
          if (al && !al.locked && layers.length > 1) deleteLayer(al.id);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && tag !== 'input' && tag !== 'textarea') {
        e.preventDefault();
        const items = (e.clipboardData || window.clipboardData)?.items;
        if (items) {
          for (const item of items) {
            if (item.type.startsWith('image/')) {
              const file = item.getAsFile();
              handleImageFile(file);
              return;
            }
          }
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') { e.preventDefault(); const al = layers.find(l => l.id === activeLayerId); if (al) duplicateLayer(al.id); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault(); if (editingText) commitText();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); if (editingText) commitText(); redo(); return; }
      if (tag !== 'input' && tag !== 'textarea') {
        if (e.key === 'v' || e.key === 'V') setActiveTool('move');
        else if (e.key === 't' || e.key === 'T') setActiveTool('text');
        else if (e.key === 'i' || e.key === 'I') setActiveTool('image');
        else if (e.key === 'Escape') { if (editingText) cancelText(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [screen, layers, activeLayerId, editingText, deleteLayer, duplicateLayer, cancelText, undo, redo, handleImageFile]);

  // ---- Resize ----
  useEffect(() => {
    const handler = () => { if (screen === 'editor') scheduleRender(); };
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [screen, scheduleRender]);

  // ---- Export ----
  const renderSlideToCanvas = useCallback((slide, cvs) => {
    const ctx = cvs.getContext('2d'); const w = slide.width, h = slide.height;
    cvs.width = w; cvs.height = h;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    for (const layer of slide.layers) {
      if (!layer.visible) continue;
      ctx.save(); ctx.globalAlpha = layer.opacity;
      if (layer.type === 'raster' && layer.content) {
        const tc = document.createElement('canvas'); tc.width = layer.content.width; tc.height = layer.content.height;
        tc.getContext('2d').putImageData(layer.content, 0, 0);
        ctx.drawImage(tc, layer.x, layer.y, layer.width, layer.height);
      } else if (layer.type === 'shape') {
        renderShapeLayer(ctx, layer);
      } else if (layer.type === 'text') {
        ctx.fillStyle = layer.textColor || '#000';
        ctx.font = (layer.fontStyle||'normal') + ' ' + (layer.fontWeight||'normal') + ' ' + (layer.fontSize||48) + 'px "' + (layer.fontFamily||'Inter Tight') + '"';
        ctx.textBaseline = 'top';
        ctx.fillText(layer.text || '', layer.x, layer.y);
      }
      ctx.restore();
    }
  }, []);

  const exportPNG = useCallback(() => {
    const slide = slides[activeSlideIdx]; if (!slide) return;
    const cvs = document.createElement('canvas');
    renderSlideToCanvas(slide, cvs);
    cvs.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'slide.png'; a.click();
      URL.revokeObjectURL(url);
    });
  }, [slides, activeSlideIdx, renderSlideToCanvas]);

  const exportPDF = useCallback(() => {
    if (slides.length === 0) return;
    const w = slides[0].width, h = slides[0].height;
    const pdf = new jsPDF({ orientation: w > h ? 'landscape' : 'portrait', unit: 'px', format: [w, h] });
    slides.forEach((slide, i) => {
      if (i > 0) pdf.addPage([w, h]);
      const cvs = document.createElement('canvas');
      renderSlideToCanvas(slide, cvs);
      pdf.addImage(cvs.toDataURL('image/png'), 'PNG', 0, 0, w, h);
    });
    pdf.save('vicedesign.pdf');
  }, [slides, renderSlideToCanvas]);

  // ---- Landing anims ----
  useEffect(() => {
    if (screen !== 'landing') return;
    document.querySelector('.landing-header')?.style.setProperty('opacity', '1');
    document.querySelector('.hero-title')?.style.setProperty('opacity', '1');
    document.querySelector('.hero-subtitle')?.style.setProperty('opacity', '1');
    document.querySelector('.hero-actions')?.style.setProperty('opacity', '1');
    ['.blob-1','.blob-2','.blob-3'].forEach(s => document.querySelector(s)?.style.setProperty('opacity', '0.5'));
  }, [screen]);

  // ---- Color wheel ----
  const drawColorWheel = useCallback(() => {
    const cvs = colorWheelRef.current; if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const w = cvs.width, h = cvs.height, cx = w/2, cy = h/2, rad = w/2-2;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x-cx, dy = y-cy, dist = Math.sqrt(dx*dx+dy*dy);
        const idx = (y*w+x)*4;
        if (dist <= rad) {
          const hue = ((Math.atan2(dy,dx)+Math.PI)/(Math.PI*2))*360;
          const sat = Math.min(dist/rad,1)*100;
          const rgb = hslToRgb(hue, sat, 50);
          img.data[idx]=rgb.r; img.data[idx+1]=rgb.g; img.data[idx+2]=rgb.b; img.data[idx+3]=255;
        } else { img.data[idx+3]=0; }
      }
    }
    ctx.putImageData(img,0,0);
    wheelCache.current = ctx.getImageData(0,0,w,h);
  }, []);

  useEffect(() => { if (showColorPopup) drawColorWheel(); }, [showColorPopup, drawColorWheel]);

  // ============================================================
  //  RENDER
  // ============================================================
  const slide = slides[activeSlideIdx];

  if (screen === 'landing') {
    return (
      <>
        {loading && (
          <div className="loading-overlay">
            <div className="loader">
              <svg className="loader-spinner" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
              <p className="loader-text">Preparando tu lienzo...</p>
            </div>
          </div>
        )}
        {showModal && (
          <SetupModal
            projW={projW} projH={projH} activePreset={activePreset}
            setProjW={setProjW} setProjH={setProjH} setActivePreset={setActivePreset}
            onClose={() => setShowModal(false)} onCreate={createProject}
          />
        )}
        <div className="landing">
          <div className="landing-shapes">
            <div className="blob blob-1" /><div className="blob blob-2" /><div className="blob blob-3" />
          </div>
          <header className="landing-header">
            <span className="landing-logo">ViceDesign</span>
            <div style={{flex:1}} />
            <button className="theme-toggle" onClick={() => setDark(d => !d)} title="Cambiar tema">
              {dark ? '\u2600' : '\u263E'}
            </button>
          </header>
          <main className="landing-hero">
            <h1 className="hero-title">Diseña de forma<br/><span className="gradient-text">intuitiva</span></h1>
            <p className="hero-subtitle">Editor de diseño 100% open source. Creá, editá y exportá sin limites. Simple, rápido y gratuito.</p>
            <div className="hero-actions">
              <button className="btn-hero btn-primary" onClick={() => setShowModal(true)}>Comenzar ahora</button>
              <button className="btn-hero btn-secondary" onClick={() => alert('Contacto y precios - Proximamente')}>Contacto y precios</button>
            </div>
          </main>
        </div>
      </>
    );
  }

  return (
    <>
      {loading && (
        <div className="loading-overlay">
          <div className="loader">
            <svg className="loader-spinner" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
            </svg>
            <p className="loader-text">Preparando tu lienzo...</p>
          </div>
        </div>
      )}

      {showModal && (
        <SetupModal
          projW={projW} projH={projH} activePreset={activePreset}
          setProjW={setProjW} setProjH={setProjH} setActivePreset={setActivePreset}
          onClose={() => setShowModal(false)} onCreate={createProject}
        />
      )}

      <div className="editor">
        {/* Topbar with tools integrated */}
        <div className="topbar">
          <button className="topbar-btn" onClick={() => { commitText(); setScreen('landing'); }}>&larr; Inicio</button>
          <button className="topbar-btn" onClick={() => { if (editingText) commitText(); undo(); }} title="Deshacer (Ctrl+Z)" style={{padding:'6px 10px'}}>&#x21A9;</button>
          <button className="topbar-btn" onClick={() => { if (editingText) commitText(); redo(); }} title="Rehacer (Ctrl+Shift+Z)" style={{padding:'6px 10px'}}>&#x21AA;</button>
          <span className="topbar-title">ViceDesign</span>
          <span className="topbar-info">{slide?.width} x {slide?.height} px</span>
          {/* Mobile: tools toggle */}
          <button className="topbar-btn mobile-menu-btn" onClick={() => setMobileTools(p => !p)} title="Herramientas">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          {/* Tool buttons */}
          <div className={`topbar-tools ${mobileTools ? 'mobile-open' : ''}`}>
            <button className={`topbar-tool ${activeTool === 'move' ? 'active' : ''}`} onClick={() => setActiveTool('move')} title="Mover (V)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>
            </button>
            <button className={`topbar-tool ${activeTool === 'text' ? 'active' : ''}`} onClick={() => setActiveTool('text')} title="Texto (T)">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
            </button>
            <button className={`topbar-tool ${activeTool === 'image' ? 'active' : ''}`} onClick={() => { if (editingText) commitText(); setActiveTool('image'); }} title="Imagen (I)">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
            </button>
            <div className="topbar-tool-divider" />
            <button className="topbar-tool" onClick={() => { const cr = containerRef.current?.getBoundingClientRect(); if(cr) applyZoom(1.25, cr.left+cr.width/2, cr.top+cr.height/2); }} title="Zoom +">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
            <span className="zoom-level">{Math.round(zoom * 100)}%</span>
            <button className="topbar-tool" onClick={() => { const cr = containerRef.current?.getBoundingClientRect(); if(cr) applyZoom(0.8, cr.left+cr.width/2, cr.top+cr.height/2); }} title="Zoom -">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/></svg>
            </button>
            <button className="topbar-tool" onClick={fitCanvas} title="Ajustar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><polyline points="21 3 14 10"/><polyline points="3 21 10 14"/></svg>
            </button>
          </div>
          <div className="topbar-spacer" />
          {/* Project name */}
          <input className="topbar-project-name" value={projectName}
            onChange={e => setProjectName(sanitizeText(e.target.value))}
            title="Nombre del proyecto" />
          {/* Home button */}
          <button className="topbar-btn" onClick={() => { if (editingText) commitText(); setScreen('landing'); }} title="Inicio">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
          </button>
          {/* Export dropdown */}
          <div style={{position:'relative'}} ref={exportRef}>
            <button className="topbar-btn" onClick={() => setShowExportMenu(p => !p)} style={{fontWeight:600}}>Exportar ▾</button>
            {showExportMenu && (
              <div className="export-dropdown">
                <button onClick={() => { setShowExportMenu(false); exportPNG(); }}>Slide actual (PNG)</button>
                <button onClick={() => { setShowExportMenu(false); exportPDF(); }}>Todos los slides (PDF)</button>
              </div>
            )}
          </div>
          {/* Mobile: sidebar toggle */}
          <button className="topbar-btn mobile-menu-btn" onClick={() => setMobileSidebar(p => !p)} title="Panel lateral">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/></svg>
          </button>
          <button className="theme-toggle" onClick={() => setDark(d => !d)} title="Cambiar tema" style={{marginRight:'6px'}}>
            {dark ? '\u2600' : '\u263E'}
          </button>
        </div>

        {/* Main area: slides bar + canvas */}
        <div className="main-area">
          {/* Slides bar */}
          <div className="slides-bar">
            {slides.map((s, i) => (
              <div key={s.id} className={`slide-thumb ${i === activeSlideIdx ? 'active' : ''}`} onClick={() => setActiveSlideIdx(i)}>
                <canvas width="130" height="82"
                  ref={el => { if (el) { const ctx = el.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,130,82); const scale = Math.min(130/s.width, 82/s.height); ctx.save(); ctx.scale(scale, scale); for (const l of s.layers) { if (!l.visible) continue; if (l.type==='raster' && l.content) { const tc = document.createElement('canvas'); tc.width=l.content.width; tc.height=l.content.height; tc.getContext('2d').putImageData(l.content,0,0); ctx.drawImage(tc, l.x, l.y, l.width||s.width, l.height||s.height); } else if (l.type==='shape') { ctx.fillStyle = l.fillColor||'#6366f1'; ctx.fillRect(l.x, l.y, l.width, l.height); } else if (l.type==='text') { ctx.fillStyle = l.textColor||'#000'; ctx.font = (l.fontSize||12) + 'px ' + (l.fontFamily||'Inter Tight'); ctx.fillText(l.text||'', l.x, l.y + (l.fontSize||12)); } } ctx.restore(); } }}
                />
                <span className="slide-thumb-num">{i + 1}</span>
              </div>
            ))}
            <button className="slide-add-btn" onClick={addSlide} title="Nueva slide">+</button>
          </div>

          {/* Canvas area */}
          <div className="canvas-area" ref={containerRef}
            onWheel={e => {
              if (e.shiftKey) { e.preventDefault(); setPan(p => ({ x: p.x - e.deltaY, y: p.y - e.deltaX })); return; }
              if (e.ctrlKey || e.metaKey) { e.preventDefault(); applyZoom(e.deltaY > 0 ? 0.9 : 1.1, e.clientX, e.clientY); return; }
              e.preventDefault(); setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
          }}>
            <div className="canvas-wrapper" ref={canvasWrapperRef} style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}>
              <canvas ref={canvasRef} width={slide?.width || 1920} height={slide?.height || 1080}
                style={{ width: Math.round((slide?.width||1920) * zoom), height: Math.round((slide?.height||1080) * zoom), cursor: activeTool === 'text' || activeTool === 'image' ? 'crosshair' : 'default' }}
                onMouseDown={handleCanvasDown} onMouseMove={handleCanvasMove} onMouseUp={handleCanvasUp} onMouseLeave={handleCanvasUp}
                onContextMenu={e => {
                  e.preventDefault();
                  const pos = canvasToImg(e.clientX, e.clientY);
                  const slide = slides[activeSlideIdx];
                  const l = [...slide.layers].reverse().find(l => l.visible && !l.locked && l.isImage && isInsideLayer(l, pos.x, pos.y, slide.width, slide.height));
                  if (l) setCtxMenu({ x: e.clientX, y: e.clientY, layer: l });
                  else setCtxMenu(null);
                }}
              />
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <Sidebar
          activeLayer={getActiveLayer()} layers={layers} activeLayerId={activeLayerId}
          onSelectLayer={setActiveLayerId} onCreateLayer={createLayer}
          onDeleteLayer={deleteLayer} onDuplicateLayer={duplicateLayer} onReorderLayers={reorderLayers}
          onUpdateLayer={(id, updates) => updateSlide(s => ({ ...s, layers: s.layers.map(l => l.id===id ? {...l, ...updates} : l) }))}
          mobileSidebar={mobileSidebar}
        />
      </div>

      {/* Color wheel popup */}
      {showColorPopup && (
        <ColorPopup
          colorWheelRef={colorWheelRef} wheelCache={wheelCache} wheelHSL={wheelHSL}
          setWheelHSL={setWheelHSL} brushColor={brushColor} setBrushColor={setBrushColor}
          onClose={() => setShowColorPopup(false)}
        />
      )}

      {/* Text editor overlay */}
      {editingText && (
        <TextOverlay
          editingText={editingText}
          layer={layers.find(l => l.id === editingText.layerId)}
          zoom={zoom}
          onCommit={commitText} onCancel={cancelText}
          onChange={(txt) => {
            updateSlide(s => ({ ...s, layers: s.layers.map(l => l.id===editingText.layerId ? {...l, text: sanitizeText(txt||''), name: sanitizeText(txt||'Texto').trimEnd().substring(0,20)} : l) }));
          }}
        />
      )}
      {/* Mobile overlay */}
      {mobileSidebar && <div className="mobile-overlay mobile-open" onClick={() => setMobileSidebar(false)} />}

      {/* Hidden file input for image import */}
      <input type="file" id="image-file-input" accept="image/*" style={{display:'none'}}
        onChange={e => { if (e.target.files[0]) handleImageFile(e.target.files[0]); e.target.value = ''; }} />

      {/* Context menu */}
      {ctxMenu && (
        <>
          <div style={{position:'fixed', inset:0, zIndex:5000}} onClick={() => setCtxMenu(null)} />
          <div style={{position:'fixed', left:ctxMenu.x, top:ctxMenu.y, zIndex:5001, background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'var(--radius-md)', boxShadow:'var(--shadow-lg)', minWidth:160, overflow:'hidden'}}>
            <button style={{display:'block', width:'100%', padding:'10px 14px', fontSize:13, textAlign:'left', color:'var(--text-pri)', borderBottom:'1px solid var(--border)'}}
              onClick={() => {
                updateSlide(s => ({ ...s, layers: s.layers.map(l => l.id===ctxMenu.layer.id ? { ...l, isImage: false, name: (l.name||'Imagen') + ' rasterizada' } : l) }));
                setCtxMenu(null);
              }}
              onMouseEnter={e => e.target.style.background = 'var(--bg-hover)'}
              onMouseLeave={e => e.target.style.background = 'transparent'}>
              Rasterizar capa
            </button>
          </div>
        </>
      )}
    </>
  );
}

// ============================================================
//  SUB-COMPONENTS
// ============================================================

function SetupModal({ projW, projH, activePreset, setProjW, setProjH, setActivePreset, onClose, onCreate }) {
  return (
    <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card">
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h3 className="modal-title">Nuevo proyecto</h3>
        <div className="modal-section">
          <label className="modal-label">Tamanos recomendados</label>
          <div className="presets-grid">
            {PRESET_SIZES.map(([label, w, h], i) => (
              <button key={i} className={`preset-btn ${i === activePreset ? 'active' : ''}`}
                onClick={() => { setActivePreset(i); setProjW(w); setProjH(h); }}>
                <span className="preset-ratio">{label}</span>
                <span className="preset-dims">{w} x {h}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-section">
          <label className="modal-label">Tamano personalizado (px)</label>
          <div className="custom-size-row">
            <div className="size-group"><label>Ancho</label><input type="number" value={projW} onChange={e => { setActivePreset(-1); setProjW(parseInt(e.target.value)||1); }} min="1" max="10000" /></div>
            <span className="size-sep">x</span>
            <div className="size-group"><label>Alto</label><input type="number" value={projH} onChange={e => { setActivePreset(-1); setProjH(parseInt(e.target.value)||1); }} min="1" max="10000" /></div>
          </div>
        </div>
        <button className="create-btn" onClick={() => { setProjW(clamp(projW,1,10000)); setProjH(clamp(projH,1,10000)); onCreate(); }}>Crear proyecto</button>
      </div>
    </div>
  );
}

function Sidebar({ activeLayer, layers, activeLayerId, onSelectLayer, onCreateLayer, onDeleteLayer, onDuplicateLayer, onReorderLayers, onUpdateLayer, mobileSidebar }) {
  const [collapsed, setCollapsed] = useState({ shapes: false, layers: false, text: false, color: false });
  const [dragIdx, setDragIdx] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const toggle = (s) => setCollapsed(p => ({ ...p, [s]: !p[s] }));

  const isShape = activeLayer?.type === 'shape';
  const isText = activeLayer?.type === 'text';
  const [gradColor1, setGradColor1] = useState('#6366f1');
  const [gradColor2, setGradColor2] = useState('#ec4899');
  const [gradDir, setGradDir] = useState('h');

  return (
        <div className={`sidebar ${!mobileSidebar ? 'hidden-mobile' : ''}`}>
      {/* Shapes section */}
      <div className="sec-section">
        <div className={`sec-header ${collapsed.shapes ? 'collapsed' : ''}`} onClick={() => toggle('shapes')}>
          <span>Elementos graficos</span>
          <svg className="sec-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div className={`sec-body ${collapsed.shapes ? 'hidden' : ''}`}>
          <div className="shapes-grid">
            {[['rect','Rectangulo'],['circle','Circulo'],['polygon','Poligono'],['star','Estrella'],['line','Linea']].map(([shape, title]) => (
              <button key={shape} className="shape-btn" title={title}
                onClick={() => onCreateLayer('shape', { shapeType: shape, fillColor:'#6366f1', cornerRadius:0, sides:shape==='star'?5:5, x:200, y:200, width:200, height:shape==='line'?4:200, name:title })}>
                <ShapeIcon shape={shape} />
              </button>
            ))}
          </div>
          {isShape && activeLayer.shapeType !== 'circle' && (
            <div style={{padding:'0 14px 8px'}}>
              <label style={{fontSize:11, color:'var(--text-sec)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.6px', display:'block', marginBottom:4}}>Bordes redondeados</label>
              <div className="prop-row prop-slider" style={{padding:0, marginBottom: activeLayer.shapeType === 'rect' ? 6 : 0}}>
                <label style={{fontSize:10}}>General</label>
                <input type="range" value={activeLayer.cornerTL || 0} min="0" max="200" step="1"
                  onChange={e => {
                    const v = parseInt(e.target.value) || 0;
                    onUpdateLayer(activeLayer.id, { cornerTL: v, cornerTR: v, cornerBL: v, cornerBR: v });
                  }} />
              </div>
              {activeLayer.shapeType === 'rect' && (
                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:4}}>
                  {[
                    ['TL', 'cornerTL'],
                    ['TR', 'cornerTR'],
                    ['BL', 'cornerBL'],
                    ['BR', 'cornerBR'],
                  ].map(([label, key]) => (
                    <div key={key} className="prop-row" style={{padding:0, gap:4}}>
                      <label style={{fontSize:10, width:16}}>{label}</label>
                      <input type="number" value={activeLayer[key] || 0} min="0" max="500" style={{width:'100%', padding:'3px 4px', fontSize:11, background:'var(--bg-primary)', border:'1px solid var(--border)', borderRadius:'var(--radius-sm)', textAlign:'center', outline:'none'}}
                        onChange={e => onUpdateLayer(activeLayer.id, { [key]: parseInt(e.target.value) || 0 })} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {(isShape && (activeLayer.shapeType === 'polygon' || activeLayer.shapeType === 'star')) && (
            <div className="prop-row prop-slider">
              <label>Puntas ({activeLayer.sides || 5})</label>
              <input type="range" value={activeLayer.sides || 5} min="3" max="16" step="1"
                onChange={e => onUpdateLayer(activeLayer.id, { sides: parseInt(e.target.value)||3 })} />
            </div>
          )}
        </div>
      </div>

      {/* Color section */}
      <div className="sec-section">
        <div className={`sec-header ${collapsed.color ? 'collapsed' : ''}`} onClick={() => toggle('color')}>
          <span>Color</span>
          <svg className="sec-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div className={`sec-body ${collapsed.color ? 'hidden' : ''}`}>
          {/* Solid color */}
          <div style={{padding:'8px 14px 4px'}}>
            <label style={{fontSize:10,fontWeight:600,textTransform:'uppercase',color:'var(--text-mut)'}}>Color solido</label>
          </div>
          <div className="prop-row">
            <label>Relleno</label>
            <input type="color" value={activeLayer && (activeLayer.type==='shape'||activeLayer.type==='raster') ? (activeLayer.fillColor||'#6366f1') : '#6366f1'}
              onChange={e => {
                if (!activeLayer) return;
                if (activeLayer.type === 'shape') {
                  onUpdateLayer(activeLayer.id, { fillColor: e.target.value, gradColor1: null, gradColor2: null });
                } else if (activeLayer.type === 'raster' && activeLayer.content) {
                  const rgb = hexToRgb(e.target.value);
                  const d = new Uint8ClampedArray(activeLayer.content.data);
                  for (let i = 0; i < d.length; i += 4) {
                    if (d[i+3] > 0) { d[i]=rgb.r; d[i+1]=rgb.g; d[i+2]=rgb.b; }
                  }
                  onUpdateLayer(activeLayer.id, { content: new ImageData(d, activeLayer.content.width, activeLayer.content.height) });
                }
              }} />
          </div>

          {/* Gradient */}
          <div style={{padding:'8px 14px 4px'}}>
            <label style={{fontSize:10,fontWeight:600,textTransform:'uppercase',color:'var(--text-mut)'}}>Degradado</label>
          </div>
          <div className="prop-row">
            <label>Color 1</label>
            <input type="color" value={gradColor1} onChange={e => setGradColor1(e.target.value)} />
          </div>
          <div className="prop-row">
            <label>Color 2</label>
            <input type="color" value={gradColor2} onChange={e => setGradColor2(e.target.value)} />
          </div>
          <div className="prop-row">
            <label>Direccion</label>
            <select value={gradDir} onChange={e => setGradDir(e.target.value)}>
              <option value="h">Horizontal</option>
              <option value="v">Vertical</option>
              <option value="d">Diagonal</option>
            </select>
          </div>
          <div className="prop-row">
            <label></label>
            <button className="topbar-btn" onClick={() => {
              if (!activeLayer || activeLayer.type !== 'shape') return;
              onUpdateLayer(activeLayer.id, { fillColor: null, gradColor1, gradColor2, gradDir });
            }} style={{background:'var(--accent)',color:'#fff',fontWeight:600,padding:'5px 14px',borderRadius:'var(--radius-sm)'}}>
              Aplicar degradado
            </button>
          </div>
        </div>
      </div>

      {/* Layers section */}
      <div className="sec-section">
        <div className={`sec-header ${collapsed.layers ? 'collapsed' : ''}`} onClick={() => toggle('layers')}>
          <span>Capas</span>
          <svg className="sec-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div className={`sec-body ${collapsed.layers ? 'hidden' : ''}`}>
          <div className="layers-actions">
            <button className="icon-btn" onClick={() => onCreateLayer('raster', {})} title="Nueva capa">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            <button className="icon-btn" onClick={() => activeLayer && onDeleteLayer(activeLayer.id)} title="Eliminar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
            <button className="icon-btn" onClick={() => activeLayer && onDuplicateLayer(activeLayer.id)} title="Duplicar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="1"/><path d="M5 15H4a1 1 0 01-1-1V4a1 1 0 011-1h10a1 1 0 011 1v1"/></svg>
            </button>
          </div>
          <div className="layers-list">
            {[...layers].reverse().map((l) => {
              const idx = layers.indexOf(l);
              return (
                <div key={l.id} className={`layer-item ${l.id === activeLayerId ? 'selected' : ''} ${l.locked ? 'locked' : ''} ${dragOver === idx ? 'drag-over' : ''} ${dragIdx === idx ? 'dragging' : ''}`}
                  onClick={() => onSelectLayer(l.id)}
                  draggable={!l.locked}
                  onDragStart={e => { if (l.locked) return; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', idx); setDragIdx(idx); }}
                  onDragEnd={() => { setDragIdx(null); setDragOver(null); }}
                  onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragIdx !== idx && dragIdx !== null) setDragOver(idx); }}
                  onDragLeave={() => { if (dragOver === idx) setDragOver(null); }}
                  onDrop={e => { e.preventDefault(); setDragOver(null); if (dragIdx !== null && dragIdx !== idx) onReorderLayers(dragIdx, idx); }}>
                  <div className="layer-thumb">
                    <canvas width="36" height="36" ref={el => { if (el) { const c = el.getContext('2d'); c.fillStyle = l.type==='shape' ? (l.fillColor||'#6366f1') : (l.type==='text' ? '#666' : '#eee'); l.type==='text' ? (c.font='bold 14px Inter Tight', c.textAlign='center', c.fillText('T',18,24)) : c.fillRect(4,8,28,20); } }} />
                  </div>
                  <div className="layer-info">
                    <div className="layer-name">{l.name}</div>
                    <div className="layer-type">{l.type==='text'?'Texto':l.type==='shape'?'Forma':l.locked?'Fondo (bloqueado)':'Mapa de bits'}</div>
                  </div>
                  {l.locked && <span className="layer-lock">🔒</span>}
                  <button className={`layer-vis ${!l.visible ? 'hidden' : ''}`} onClick={e => { e.stopPropagation(); onUpdateLayer(l.id, { visible: !l.visible }); }}>
                    {l.visible
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    }
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Text section */}
      <div className="sec-section">
        <div className={`sec-header ${collapsed.text ? 'collapsed' : ''}`} onClick={() => toggle('text')}>
          <span>Texto</span>
          <svg className="sec-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div className={`sec-body ${collapsed.text ? 'hidden' : ''}`}>
          {isText && (
            <>
              <div className="text-presets">
                {[[72,'Titulo'],[48,'Subtitulo'],[24,'Parrafo']].map(([size, label]) => (
                  <button key={size} className={`size-preset ${activeLayer.fontSize === size ? 'active' : ''}`}
                    onClick={() => onUpdateLayer(activeLayer.id, { fontSize: size })}>{label}</button>
                ))}
              </div>
              <div className="prop-row prop-slider">
                <label>Tamano ({activeLayer.fontSize || 48}px)</label>
                <input type="range" value={activeLayer.fontSize || 48} min="8" max="400" step="1"
                  onChange={e => onUpdateLayer(activeLayer.id, { fontSize: parseInt(e.target.value)||48 })} />
              </div>
              <div className="prop-row">
                <label>Tipografia</label>
                <select value={activeLayer.fontFamily || 'Inter Tight'}
                  onChange={e => onUpdateLayer(activeLayer.id, { fontFamily: e.target.value })}>
                  {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="prop-row">
                <label>Color</label>
                <input type="color" value={activeLayer.textColor || '#000000'}
                  onChange={e => onUpdateLayer(activeLayer.id, { textColor: e.target.value })} />
              </div>
              <div className="prop-row">
                <label>Estilo</label>
                <div className="style-row">
                  <button className={`toggle-btn ${activeLayer.fontWeight === 'bold' ? 'active' : ''}`}
                    onClick={() => onUpdateLayer(activeLayer.id, { fontWeight: activeLayer.fontWeight === 'bold' ? 'normal' : 'bold' })}>B</button>
                  <button className={`toggle-btn italic ${activeLayer.fontStyle === 'italic' ? 'active' : ''}`}
                    onClick={() => onUpdateLayer(activeLayer.id, { fontStyle: activeLayer.fontStyle === 'italic' ? 'normal' : 'italic' })}>I</button>
                </div>
              </div>
            </>
          )}
          {!isText && <p style={{padding:'20px 14px', fontSize:'12px', color:'var(--text-mut)', textAlign:'center'}}>Selecciona una capa de texto para editar sus propiedades</p>}
        </div>
      </div>
    </div>
  );
}

function ShapeIcon({ shape }) {
  switch (shape) {
    case 'rect': return <svg width="22" height="16" viewBox="0 0 22 16"><rect x="1" y="1" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>;
    case 'circle': return <svg width="22" height="22" viewBox="0 0 22 22"><ellipse cx="11" cy="11" rx="9" ry="9" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>;
    case 'polygon': return <svg width="22" height="20" viewBox="0 0 24 22"><polygon points="12,1 22,8 19,20 5,20 2,8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
    case 'star': return <svg width="22" height="22" viewBox="0 0 22 22"><polygon points="11,2 14,8 20,9 15.5,14 16.5,20 11,17 5.5,20 6.5,14 2,9 8,8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/></svg>;
    case 'line': return <svg width="22" height="22" viewBox="0 0 22 22"><line x1="2" y1="20" x2="20" y2="2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>;
    default: return null;
  }
}

function ColorPopup({ colorWheelRef, wheelCache, wheelHSL, setWheelHSL, brushColor, setBrushColor, onClose }) {
  const [hex, setHex] = useState(rgbToHex(brushColor.r, brushColor.g, brushColor.b));

  const pickColor = (e) => {
    const cvs = colorWheelRef.current; if (!cvs) return;
    const r = cvs.getBoundingClientRect();
    const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const w = cvs.width, center = w/2, rad = w/2-2;
    const dx = cx - center, dy = cy - center, dist = Math.sqrt(dx*dx+dy*dy);
    if (dist > rad) return;
    const hue = ((Math.atan2(dy,dx)+Math.PI)/(Math.PI*2))*360;
    const sat = Math.min(dist/rad, 1)*100;
    setWheelHSL({ h: hue, s: sat, bri: wheelHSL.bri });
    const hslRgb = hslToRgb(hue, sat, 50);
    const bri = wheelHSL.bri;
    const blend = (c, b) => Math.round(c + (b-c)*(bri/100));
    const col = { r: blend(hslRgb.r,255), g: blend(hslRgb.g,255), b: blend(hslRgb.b,255) };
    setBrushColor(col);
    setHex(rgbToHex(col.r, col.g, col.b));
  };

  const drawCrosshair = () => {
    const cvs = colorWheelRef.current; if (!cvs || !wheelCache.current) return;
    const ctx = cvs.getContext('2d');
    ctx.putImageData(wheelCache.current, 0, 0);
    const w = cvs.width, cx = w/2;
    const angle = wheelHSL.h * Math.PI/180;
    const dist = (wheelHSL.s/100)*(w/2-4);
    const kx = cx + Math.cos(angle-Math.PI)*dist;
    const ky = cx + Math.sin(angle-Math.PI)*dist;
    ctx.beginPath(); ctx.arc(kx,ky,5,0,Math.PI*2); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
    ctx.beginPath(); ctx.arc(kx,ky,6,0,Math.PI*2); ctx.strokeStyle='#000'; ctx.lineWidth=1; ctx.stroke();
  };

  useEffect(() => { drawCrosshair(); }, [wheelHSL]);

  const curHex = rgbToHex(brushColor.r, brushColor.g, brushColor.b);

  return (
    <div className="color-popup">
      <div className="cw-header">Selector de color</div>
      <canvas ref={colorWheelRef} className="cw-canvas" width="220" height="220"
        onMouseDown={pickColor} onMouseMove={e => { if (e.buttons===1) pickColor(e); }} />
      <div className="cw-brightness">
        <label>Brillo</label>
        <input type="range" min="0" max="100" value={wheelHSL.bri}
          onChange={e => {
            const bri = parseInt(e.target.value)||100;
            setWheelHSL(p => ({ ...p, bri }));
            const hslRgb = hslToRgb(wheelHSL.h, wheelHSL.s, 50);
            const blend = (c, b) => Math.round(c + (b-c)*(bri/100));
            const col = { r: blend(hslRgb.r,255), g: blend(hslRgb.g,255), b: blend(hslRgb.b,255) };
            setBrushColor(col);
            setHex(rgbToHex(col.r, col.g, col.b));
          }} />
      </div>
      <div className="cw-footer">
        <div className="cw-swatch" style={{ background: curHex }} />
        <input className="cw-hex" value={hex} maxLength="7"
          onChange={e => { setHex(e.target.value); if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) { const rgb = hexToRgb(e.target.value); setBrushColor(rgb); } }}
          onKeyDown={e => { if (e.key==='Enter') onClose(); }} />
        <button className="cw-apply" onClick={onClose}>Aplicar</button>
      </div>
    </div>
  );
}

function TextOverlay({ editingText, layer, zoom, onCommit, onCancel, onChange }) {
  const inputRef = useRef(null);
  const mountedRef = useRef(false);
  const fs = layer?.fontSize || 48;
  const ff = layer?.fontFamily || 'Inter Tight';
  const fc = layer?.textColor || '#000';
  const fw = layer?.fontWeight || 'normal';
  const fst = layer?.fontStyle || 'normal';

  useEffect(() => {
    const inp = inputRef.current;
    if (inp) {
      // Small delay prevents race with mousedown bubbling
      setTimeout(() => { mountedRef.current = true; inp.focus(); inp.select(); }, 10);
    }
    return () => { mountedRef.current = false; };
  }, []);

  const r = document.querySelector('.canvas-wrapper')?.getBoundingClientRect();
  const left = r ? r.left + editingText.x * zoom : 0;
  const top = r ? r.top + editingText.y * zoom : 0;

  return (
    <div className="text-overlay active" style={{ left, top }}>
      <input ref={inputRef} id="text-editor-input" defaultValue={editingText.text}
        style={{ fontSize: fs, fontFamily: ff, color: fc, fontWeight: fw, fontStyle: fst }}
        onInput={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key==='Enter') { e.preventDefault(); onCommit(); } if (e.key==='Escape') { onCancel(); } }}
        onBlur={() => { if (mountedRef.current) setTimeout(onCommit, 150); }}
        placeholder="Escribe algo" />
    </div>
  );
}

export default App;
