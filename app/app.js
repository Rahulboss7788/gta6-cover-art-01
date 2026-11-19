// Vice Cover Studio — a GTA 6-style multi-panel cover art maker.
// Everything runs offline: photos are read locally, fonts are vendored
// under fonts/, and the cover is drawn on a <canvas> and exported as PNG.
"use strict";

const $ = (id) => document.getElementById(id);
const preview = $("preview");
const pctx = preview.getContext("2d");

const SIZES = {
  "1080x1080": { w: 1080, h: 1080, label: "1080 × 1080 · Square" },
  "1080x1350": { w: 1080, h: 1350, label: "1080 × 1350 · Portrait" },
  "1920x1080": { w: 1920, h: 1080, label: "1920 × 1080 · Wide" },
};

// ---------------------------------------------------------------- state
const state = {
  layout: "strip",
  sizeKey: "1080x1080",
  grade: "sunset",
  caption: "SUNSET HEIST",
  subtitle: "VICE CITY · SUMMER 2026",
  captionStyle: "outline",
  captionPos: "bottom",
  activePanel: 0,
  photos: [], // { id, name, img }
  panels: [], // { photoId, zoom, ox, oy, flip } — one per layout slot
  lastExport: null,
  shotMode: null,
};
let nextPhotoId = 1;

function panelCount(layout) {
  return layout === "grid" ? 4 : 3;
}

function resetPanels() {
  const n = panelCount(state.layout);
  const first = state.photos[0] ? state.photos[0].id : null;
  const second = state.photos[1] ? state.photos[1].id : first;
  state.panels = Array.from({ length: n }, (_, i) => ({
    photoId: i === 0 ? first : i === 1 ? second : first,
    zoom: 1.15,
    ox: 0,
    oy: 0,
    flip: false,
  }));
  state.activePanel = 0;
}

// ------------------------------------------------------------ layouts
// Each layout returns panel polygons as fractions of the cover size,
// plus the skyline band the caption sits on.
function layoutPolys(layout, W, H) {
  const slant = 0.055; // diagonal lean of the strip dividers, in W units
  if (layout === "grid") {
    const g = 0.012;
    return [
      [[0, 0], [0.5 - g / 2, 0], [0.5 - g / 2, 0.5 - g / 2], [0, 0.5 - g / 2]],
      [[0.5 + g / 2, 0], [1, 0], [1, 0.5 - g / 2], [0.5 + g / 2, 0.5 - g / 2]],
      [[0, 0.5 + g / 2], [0.5 - g / 2, 0.5 + g / 2], [0.5 - g / 2, 1], [0, 1]],
      [[0.5 + g / 2, 0.5 + g / 2], [1, 0.5 + g / 2], [1, 1], [0.5 + g / 2, 1]],
    ];
  }
  if (layout === "hero") {
    const g = 0.012;
    return [
      [[0, 0], [0.58, 0], [0.58, 1], [0, 1]],
      [[0.58 + g, 0], [1, 0], [1, 0.5 - g / 2], [0.58 + g, 0.5 - g / 2]],
      [[0.58 + g, 0.5 + g / 2], [1, 0.5 + g / 2], [1, 1], [0.58 + g, 1]],
    ];
  }
  // strip: three slanted panels, like a poster triptych
  return [
    [[0, 0], [0.36, 0], [0.30, 1], [0, 1]],
    [[0.36 + slant, 0], [0.68, 0], [0.62, 1], [0.30 + slant, 1]],
    [[0.68 + slant, 0], [1, 0], [1, 1], [0.62 + slant, 1]],
  ];
}

function polyBounds(poly, W, H) {
  const xs = poly.map((p) => p[0] * W);
  const ys = poly.map((p) => p[1] * H);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  const y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function pointInPoly(px, py, poly, W, H) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0] * W, yi = poly[i][1] * H;
    const xj = poly[j][0] * W, yj = poly[j][1] * H;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------ skyline
// Deterministic pseudo-random from an index, so the skyline never changes.
function hashRand(i) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function drawSkyline(ctx, W, H) {
  const base = H * 0.86;
  ctx.fillStyle = "#1a0b2e";
  let x = 0;
  let i = 0;
  while (x < W) {
    const bw = W * (0.05 + hashRand(i) * 0.07);
    const bh = H * (0.05 + hashRand(i + 40) * 0.11);
    ctx.fillRect(x, base - bh, bw, bh + H * 0.14);
    if (hashRand(i + 80) > 0.6) {
      // antenna on a few towers
      ctx.fillRect(x + bw / 2 - 1, base - bh - H * 0.03, 2, H * 0.03);
    }
    x += bw + W * 0.004;
    i++;
  }
  // Lit windows: tiny gold dots scattered over the towers.
  ctx.fillStyle = "rgba(255, 201, 60, 0.85)";
  for (let k = 0; k < 90; k++) {
    const wx = hashRand(k + 200) * W;
    const wy = base - hashRand(k + 400) * H * 0.14;
    ctx.fillRect(wx, wy, Math.max(2, W * 0.002), Math.max(2, H * 0.002));
  }
}

function drawPalm(ctx, x, y, s, lean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.rotate(lean);
  ctx.strokeStyle = "#160a26";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(14, -70, 34, -120);
  ctx.stroke();
  ctx.lineWidth = 5;
  for (let f = 0; f < 7; f++) {
    const a = (-Math.PI / 7) * f - 0.35;
    const len = 62 - Math.abs(f - 3) * 7;
    ctx.beginPath();
    ctx.moveTo(34, -120);
    ctx.quadraticCurveTo(
      34 + Math.cos(a) * len * 0.6, -120 + Math.sin(a) * len * 0.55 - 14,
      34 + Math.cos(a) * len, -120 + Math.sin(a) * len + 18,
    );
    ctx.stroke();
  }
  ctx.restore();
}

// ------------------------------------------------------------ photos
function drawPhotoInto(ctx, img, rect, panel) {
  const { x, y, w, h } = rect;
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = Math.max(w / iw, h / ih) * panel.zoom;
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = x + (w - dw) / 2 + panel.ox * w;
  const dy = y + (h - dh) / 2 + panel.oy * h;
  // Straightforward path: mirror around the panel's centre when flipped.
  ctx.save();
  if (panel.flip) {
    ctx.translate(x * 2 + w, 0);
    ctx.scale(-1, 1);
  }
  const grade = state.grade;
  if (grade === "noir") ctx.filter = "saturate(0.35) contrast(1.3) brightness(0.88)";
  else if (grade === "neon") ctx.filter = "saturate(1.35) contrast(1.12)";
  else if (grade === "sunset") ctx.filter = "saturate(1.25) contrast(1.06) brightness(1.03)";
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.filter = "none";
  ctx.restore();

  // Colour-grade wash on top of the photo.
  ctx.save();
  if (grade === "sunset") {
    const g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, "rgba(255, 122, 26, 0.10)");
    g.addColorStop(1, "rgba(255, 46, 136, 0.28)");
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  } else if (grade === "neon") {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, "rgba(255, 46, 136, 0.30)");
    g.addColorStop(1, "rgba(25, 227, 255, 0.30)");
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  } else if (grade === "noir") {
    ctx.globalCompositeOperation = "overlay";
    ctx.fillStyle = "rgba(20, 10, 40, 0.35)";
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
  // Vignette inside the panel.
  const v = ctx.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.35, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
  v.addColorStop(0, "rgba(0,0,0,0)");
  v.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = v;
  ctx.fillRect(x, y, w, h);
}

function tracePoly(ctx, poly, W, H) {
  ctx.beginPath();
  poly.forEach(([fx, fy], i) => {
    if (i === 0) ctx.moveTo(fx * W, fy * H);
    else ctx.lineTo(fx * W, fy * H);
  });
  ctx.closePath();
}

// ------------------------------------------------------------ caption
function fitFont(ctx, text, maxWidth, startPx, family) {
  let px = startPx;
  ctx.font = `${px}px ${family}`;
  while (px > 24 && ctx.measureText(text).width > maxWidth) {
    px -= 4;
    ctx.font = `${px}px ${family}`;
  }
  return px;
}

function drawCaption(ctx, W, H) {
  const text = (state.caption || "SUNSET HEIST").toUpperCase();
  const sub = state.subtitle || "";
  const bandH = H * 0.21;
  let bandY;
  if (state.captionPos === "top") bandY = 0;
  else if (state.captionPos === "middle") bandY = H * 0.42 - bandH / 2;
  else bandY = H - bandH;

  // Banner wash so lettering reads over any photo.
  const wash = ctx.createLinearGradient(0, bandY, 0, bandY + bandH);
  if (state.captionPos === "top") {
    wash.addColorStop(0, "rgba(10, 4, 20, 0.82)");
    wash.addColorStop(1, "rgba(10, 4, 20, 0)");
  } else {
    wash.addColorStop(0, "rgba(10, 4, 20, 0)");
    wash.addColorStop(0.35, "rgba(10, 4, 20, 0.55)");
    wash.addColorStop(1, "rgba(10, 4, 20, 0.88)");
  }
  ctx.fillStyle = wash;
  ctx.fillRect(0, bandY, W, bandH);

  const cx = W / 2;
  const capY = bandY + bandH * 0.56;
  const maxW = W * 0.92;
  const px = fitFont(ctx, text, maxW, W * 0.105, '"Anton", sans-serif');
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  try { ctx.letterSpacing = `${Math.max(2, W * 0.004)}px`; } catch { /* older canvas */ }
  ctx.lineJoin = "round";
  ctx.shadowColor = "rgba(255, 46, 136, 0.65)";
  ctx.shadowBlur = W * 0.018;
  ctx.shadowOffsetY = W * 0.004;
  if (state.captionStyle === "outline") {
    const grad = ctx.createLinearGradient(0, capY - px * 0.6, 0, capY + px * 0.6);
    grad.addColorStop(0, "#fff7d6");
    grad.addColorStop(0.45, "#ffc93c");
    grad.addColorStop(0.75, "#ff2e88");
    grad.addColorStop(1, "#ff7a1a");
    ctx.fillStyle = grad;
    ctx.lineWidth = Math.max(3, W * 0.007);
    ctx.strokeStyle = "#14041f";
    ctx.strokeText(text, cx, capY);
    ctx.fillText(text, cx, capY);
  } else if (state.captionStyle === "solid") {
    ctx.fillStyle = "#ff2e88";
    ctx.lineWidth = Math.max(3, W * 0.006);
    ctx.strokeStyle = "#ffffff";
    ctx.strokeText(text, cx, capY);
    ctx.fillText(text, cx, capY);
  } else if (state.captionStyle === "gold") {
    const grad = ctx.createLinearGradient(0, capY - px * 0.6, 0, capY + px * 0.6);
    grad.addColorStop(0, "#fff3b0");
    grad.addColorStop(0.5, "#ffc93c");
    grad.addColorStop(1, "#b97b00");
    ctx.fillStyle = grad;
    ctx.lineWidth = Math.max(3, W * 0.006);
    ctx.strokeStyle = "#241100";
    ctx.strokeText(text, cx, capY);
    ctx.fillText(text, cx, capY);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = Math.max(3, W * 0.006);
    ctx.strokeStyle = "#14041f";
    ctx.strokeText(text, cx, capY);
    ctx.fillText(text, cx, capY);
  }
  ctx.restore();

  if (sub) {
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    try { ctx.letterSpacing = `${Math.max(2, W * 0.006)}px`; } catch { /* older canvas */ }
    const subPx = fitFont(ctx, sub.toUpperCase(), maxW, W * 0.028, '"Archivo Black", sans-serif');
    ctx.font = `${subPx}px "Archivo Black", sans-serif`;
    ctx.fillStyle = "#ffe9f3";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = W * 0.006;
    ctx.fillText(sub.toUpperCase(), cx, bandY + bandH * 0.9);
    ctx.restore();
  }

  // Small corner tag, like a poster credit line.
  ctx.save();
  ctx.font = `${Math.max(11, W * 0.014)}px system-ui, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("VICE COVER STUDIO", W * 0.02, H - H * 0.015);
  ctx.textAlign = "right";
  ctx.fillText("EST. 2026", W * 0.98, H - H * 0.015);
  ctx.restore();
}

// ------------------------------------------------------------ render
function renderCover(ctx, W, H) {
  // Sunset sky.
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  if (state.grade === "neon") {
    sky.addColorStop(0, "#0d0221");
    sky.addColorStop(0.45, "#3d0a5e");
    sky.addColorStop(0.75, "#a4136b");
    sky.addColorStop(1, "#ff2e88");
  } else if (state.grade === "noir") {
    sky.addColorStop(0, "#0b0b14");
    sky.addColorStop(0.55, "#2c1230");
    sky.addColorStop(1, "#57203a");
  } else {
    sky.addColorStop(0, "#2b1055");
    sky.addColorStop(0.4, "#7597de");
    sky.addColorStop(0.62, "#ff7a1a");
    sky.addColorStop(0.8, "#ff2e88");
    sky.addColorStop(1, "#7b2fff");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // Sun with glow, small enough to peek through the panel gaps.
  const sunX = W * 0.70, sunY = H * 0.15, sunR = W * 0.05;
  const glow = ctx.createRadialGradient(sunX, sunY, sunR * 0.2, sunX, sunY, sunR * 3.2);
  glow.addColorStop(0, "rgba(255, 170, 80, 0.85)");
  glow.addColorStop(1, "rgba(255, 170, 80, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(sunX - sunR * 3.2, sunY - sunR * 3.2, sunR * 6.4, sunR * 6.4);
  ctx.fillStyle = "#ff9a3c";
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
  ctx.fill();

  drawSkyline(ctx, W, H);

  // Panels.
  const polys = layoutPolys(state.layout, W, H);
  polys.forEach((poly, i) => {
    const panel = state.panels[i];
    const bounds = polyBounds(poly, W, H);
    ctx.save();
    tracePoly(ctx, poly, W, H);
    ctx.clip();
    const photo = panel ? state.photos.find((p) => p.id === panel.photoId) : null;
    if (photo) {
      drawPhotoInto(ctx, photo.img, bounds, panel);
    } else {
      // Empty panel: a warm placeholder gradient with a hint.
      const g = ctx.createLinearGradient(bounds.x, bounds.y, bounds.x + bounds.w, bounds.y + bounds.h);
      g.addColorStop(0, "#3d1a5e");
      g.addColorStop(1, "#a4136b");
      ctx.fillStyle = g;
      ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = `${Math.max(14, W * 0.02)}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("ADD A PHOTO", bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
    }
    ctx.restore();
    // Panel frame: bright edge + dark keyline.
    ctx.save();
    tracePoly(ctx, poly, W, H);
    ctx.lineWidth = Math.max(3, W * 0.006);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.lineWidth = Math.max(1, W * 0.002);
    ctx.strokeStyle = "rgba(20, 4, 31, 0.9)";
    ctx.stroke();
    ctx.restore();
  });

  // Palm silhouettes over the panel edges.
  drawPalm(ctx, W * 0.04, H * 0.99, W / 900, -0.12);
  drawPalm(ctx, W * 0.97, H * 1.0, W / 1100, 0.14);

  drawCaption(ctx, W, H);
}

function renderPreview() {
  const size = SIZES[state.sizeKey];
  const maxSide = state.shotMode === "cover" ? Math.max(size.w, size.h) : 900;
  const scale = Math.min(1, maxSide / Math.max(size.w, size.h));
  preview.width = Math.round(size.w * scale);
  preview.height = Math.round(size.h * scale);
  renderCover(pctx, preview.width, preview.height);
  const label = $("stage-size-label");
  if (label) label.textContent = size.label;
  const zoom = $("zoom");
  const panel = state.panels[state.activePanel];
  if (zoom && panel) {
    zoom.value = String(Math.round(panel.zoom * 100));
    $("zoom-val").textContent = `${Math.round(panel.zoom * 100)}%`;
  }
}

// ------------------------------------------------------------ photos
function addPhotoFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const photo = { id: nextPhotoId++, name: file.name || "photo", img };
        state.photos.push(photo);
        if (state.photos.length === 1) resetPanels();
        else if (state.panels.length && !state.panels.some((p) => p.photoId === photo.id)) {
          // New photo goes to the active panel so it is visible at once.
          state.panels[state.activePanel].photoId = photo.id;
        }
        renderPhotoStrip();
        renderPanelList();
        renderPreview();
        resolve(photo);
      };
      img.onerror = () => reject(new Error("could not read that image"));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(new Error("could not read that file"));
    reader.readAsDataURL(file);
  });
}

function loadSample(kind) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const existing = state.photos.find((p) => p.name === kind);
      if (existing) {
        state.panels[state.activePanel].photoId = existing.id;
      } else {
        const photo = { id: nextPhotoId++, name: kind, img };
        state.photos.push(photo);
        if (state.photos.length === 1) resetPanels();
        state.panels[state.activePanel].photoId = photo.id;
      }
      renderPhotoStrip();
      renderPanelList();
      renderPreview();
      $("export-status").textContent = "Sample photo loaded — drag it, zoom it, then export.";
      resolve(true);
    };
    img.onerror = () => reject(new Error(`sample ${kind} failed to load`));
    img.src = `samples/${kind}.jpg`;
  });
}

// ------------------------------------------------------------ UI lists
function renderPhotoStrip() {
  const strip = $("photo-strip");
  strip.innerHTML = "";
  state.photos.forEach((photo) => {
    const thumb = document.createElement("img");
    thumb.src = photo.img.src;
    thumb.alt = photo.name;
    thumb.title = photo.name;
    const active = state.panels[state.activePanel];
    if (active && active.photoId === photo.id) thumb.classList.add("selected");
    thumb.addEventListener("click", () => {
      state.panels[state.activePanel].photoId = photo.id;
      renderPhotoStrip();
      renderPanelList();
      renderPreview();
    });
    strip.appendChild(thumb);
  });
}

function renderPanelList() {
  const list = $("panel-list");
  list.innerHTML = "";
  const names = state.layout === "grid"
    ? ["Top left", "Top right", "Bottom left", "Bottom right"]
    : state.layout === "hero"
      ? ["Hero (big)", "Top right", "Bottom right"]
      : ["Left panel", "Middle panel", "Right panel"];
  state.panels.forEach((panel, i) => {
    const row = document.createElement("div");
    row.className = "panel-row" + (i === state.activePanel ? " active" : "");
    const photo = state.photos.find((p) => p.id === panel.photoId);
    if (photo) {
      const thumb = document.createElement("img");
      thumb.className = "thumb";
      thumb.src = photo.img.src;
      thumb.alt = photo.name;
      row.appendChild(thumb);
    } else {
      const empty = document.createElement("span");
      empty.className = "thumb empty";
      empty.textContent = "—";
      row.appendChild(empty);
    }
    const label = document.createElement("span");
    label.className = "pname";
    label.textContent = names[i] || `Panel ${i + 1}`;
    row.appendChild(label);
    const pick = document.createElement("select");
    pick.setAttribute("aria-label", `${names[i] || `Panel ${i + 1}`} photo`);
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "No photo";
    pick.appendChild(none);
    state.photos.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = String(p.id);
      opt.textContent = p.name;
      if (p.id === panel.photoId) opt.selected = true;
      pick.appendChild(opt);
    });
    pick.addEventListener("change", () => {
      panel.photoId = pick.value ? Number(pick.value) : null;
      renderPhotoStrip();
      renderPreview();
    });
    pick.addEventListener("click", (e) => e.stopPropagation());
    row.appendChild(pick);
    row.addEventListener("click", () => {
      state.activePanel = i;
      renderPhotoStrip();
      renderPanelList();
      renderPreview();
    });
    list.appendChild(row);
  });
}

// ------------------------------------------------------------ export
async function exportCover() {
  const size = SIZES[state.sizeKey];
  const off = document.createElement("canvas");
  off.width = size.w;
  off.height = size.h;
  const octx = off.getContext("2d");
  renderCover(octx, size.w, size.h);
  const blob = await new Promise((resolve) => off.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("export produced no image");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const slug = (state.caption || "cover").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cover";
  a.href = url;
  a.download = `vice-cover-${slug}-${size.w}x${size.h}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  state.lastExport = { width: size.w, height: size.h, bytes: blob.size, name: a.download };
  const status = $("export-status");
  if (status) status.textContent = `Exported ${size.w} × ${size.h} PNG (${Math.round(blob.size / 1024)} KB) — check your downloads.`;
  const last = $("last-export");
  if (last) last.textContent = `Last export: ${a.download} · ${Math.round(blob.size / 1024)} KB`;
  return state.lastExport;
}

// ------------------------------------------------------------ events
function bindEvents() {
  $("file-input").addEventListener("change", async (e) => {
    const files = [...e.target.files];
    for (const f of files) {
      try { await addPhotoFile(f); } catch (err) { $("export-status").textContent = String(err.message || err); }
    }
    e.target.value = "";
    if (state.photos.length) $("export-status").textContent = `${state.photos.length} photo${state.photos.length > 1 ? "s" : ""} loaded — drag a panel's photo to position it.`;
  });

  $("btn-load-pier").addEventListener("click", () => loadSample("pier").catch((e) => { $("export-status").textContent = String(e.message); }));
  $("btn-load-boulevard").addEventListener("click", () => loadSample("boulevard").catch((e) => { $("export-status").textContent = String(e.message); }));

  document.querySelectorAll(".layout-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".layout-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.layout = btn.dataset.layout;
      resetPanels();
      renderPanelList();
      renderPhotoStrip();
      renderPreview();
    });
  });

  document.querySelectorAll(".size-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".size-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.sizeKey = btn.dataset.size;
      renderPreview();
    });
  });

  $("zoom").addEventListener("input", (e) => {
    const panel = state.panels[state.activePanel];
    if (!panel) return;
    panel.zoom = Number(e.target.value) / 100;
    $("zoom-val").textContent = `${e.target.value}%`;
    renderPreview();
  });

  $("grade").addEventListener("change", (e) => { state.grade = e.target.value; renderPreview(); });
  $("caption").addEventListener("input", (e) => { state.caption = e.target.value; renderPreview(); });
  $("subtitle").addEventListener("input", (e) => { state.subtitle = e.target.value; renderPreview(); });
  $("caption-style").addEventListener("change", (e) => { state.captionStyle = e.target.value; renderPreview(); });
  $("caption-pos").addEventListener("change", (e) => { state.captionPos = e.target.value; renderPreview(); });

  $("btn-flip").addEventListener("click", () => {
    const panel = state.panels[state.activePanel];
    if (panel) { panel.flip = !panel.flip; renderPreview(); }
  });
  $("btn-fill-all").addEventListener("click", () => {
    const panel = state.panels[state.activePanel];
    if (panel && panel.photoId) {
      state.panels.forEach((p) => { p.photoId = panel.photoId; });
      renderPhotoStrip();
      renderPanelList();
      renderPreview();
    }
  });

  const doExport = () => exportCover().catch((e) => { $("export-status").textContent = `Export failed: ${e.message}`; });
  $("btn-export").addEventListener("click", doExport);
  $("btn-export-top").addEventListener("click", doExport);

  // Drag to pan the active panel's photo; wheel to zoom it.
  let dragging = false;
  let lastX = 0, lastY = 0;
  let moved = false;
  preview.addEventListener("pointerdown", (e) => {
    const rect = preview.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * preview.width;
    const py = ((e.clientY - rect.top) / rect.height) * preview.height;
    const polys = layoutPolys(state.layout, preview.width, preview.height);
    for (let i = 0; i < polys.length; i++) {
      if (pointInPoly(px, py, polys[i], preview.width, preview.height)) {
        state.activePanel = i;
        renderPhotoStrip();
        renderPanelList();
        break;
      }
    }
    dragging = true;
    moved = false;
    lastX = e.clientX;
    lastY = e.clientY;
    preview.setPointerCapture(e.pointerId);
  });
  preview.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = preview.getBoundingClientRect();
    const panel = state.panels[state.activePanel];
    if (!panel) return;
    const dx = (e.clientX - lastX) / rect.width;
    const dy = (e.clientY - lastY) / rect.height;
    if (Math.abs(dx) + Math.abs(dy) > 0.002) moved = true;
    panel.ox = Math.max(-0.6, Math.min(0.6, panel.ox + dx));
    panel.oy = Math.max(-0.6, Math.min(0.6, panel.oy + dy));
    lastX = e.clientX;
    lastY = e.clientY;
    renderPreview();
  });
  preview.addEventListener("pointerup", () => { dragging = false; });
  preview.addEventListener("wheel", (e) => {
    e.preventDefault();
    const panel = state.panels[state.activePanel];
    if (!panel) return;
    panel.zoom = Math.max(0.5, Math.min(3, panel.zoom * (e.deltaY < 0 ? 1.08 : 0.93)));
    renderPreview();
  }, { passive: false });
}

// ------------------------------------------------------------ shot mode
async function applyShotParams() {
  const q = new URLSearchParams(location.search);
  const shot = q.get("shot");
  if (!shot) return;
  state.shotMode = shot;
  if (q.get("size") && SIZES[q.get("size")]) state.sizeKey = q.get("size");
  if (q.get("layout")) state.layout = q.get("layout");
  if (q.get("grade")) state.grade = q.get("grade");
  if (q.get("caption")) state.caption = q.get("caption");
  if (q.get("subtitle")) state.subtitle = q.get("subtitle");
  if (q.get("captionStyle")) state.captionStyle = q.get("captionStyle");
  if (q.get("captionPos")) state.captionPos = q.get("captionPos");
  const photo = q.get("photo") || "pier";
  try {
    await loadSample(photo);
    const other = photo === "pier" ? "boulevard" : "pier";
    await loadSample(other);
    // Alternate the two samples across the panels, so no two neighbours
    // show the same photo in a multi-panel cover.
    const firstId = state.photos.find((p) => p.name === photo)?.id;
    const otherId = state.photos.find((p) => p.name === other)?.id;
    state.panels.forEach((panel, i) => {
      panel.photoId = i % 2 === 0 ? firstId : otherId;
    });
  } catch (e) { /* shot still renders with the placeholder */ }
  if (shot === "cover") document.body.classList.add("shot-cover");
  // Sync the visible controls with the shot params.
  const cap = $("caption"); if (cap) cap.value = state.caption;
  const sub = $("subtitle"); if (sub) sub.value = state.subtitle;
  document.querySelectorAll(".layout-btn").forEach((b) => b.classList.toggle("active", b.dataset.layout === state.layout));
  document.querySelectorAll(".size-btn").forEach((b) => b.classList.toggle("active", b.dataset.size === state.sizeKey));
  renderPanelList();
  renderPhotoStrip();
  renderPreview();
}

// ------------------------------------------------------------ boot
async function boot() {
  bindEvents();
  resetPanels();
  renderPanelList();
  renderPhotoStrip();
  try {
    await document.fonts.load('90px "Anton"');
    await document.fonts.load('20px "Archivo Black"');
    await document.fonts.ready;
  } catch { /* fall back to system fonts */ }
  await applyShotParams();
  renderPreview();
  window.__coverState = {
    get photos() { return state.photos.length; },
    get layout() { return state.layout; },
    get size() { return state.sizeKey; },
    get caption() { return state.caption; },
    get lastExport() { return state.lastExport; },
    exportCover,
    state,
  };
  window.__shotReady = true;
}

boot();
