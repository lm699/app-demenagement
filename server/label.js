'use strict';
/**
 * Génération de l'étiquette, pour les deux imprimantes.
 *
 * Formats (réglage `labelFormat`) :
 *  - roll     : rouleau continu (Brother QL-700, 50 mm par défaut). La longueur de la
 *               bande découle de la hauteur des faces + la zone de pli.
 *  - shipping : étiquette d'expédition prédécoupée 4x6" (101,6 × 152,4 mm). Ici la
 *               taille est imposée : ce sont les faces qui se partagent la hauteur.
 *
 * Dispositions (`labelMode` pour le rouleau, `shippingMode` pour le 4x6) :
 *  - fold   : 2 faces, MÊME sens, à plier sur l'arête du carton. La moitié basse se
 *             colle sur la face latérale, la moitié haute retombe sur le dessus.
 *             Les deux se lisent à l'endroit. (défaut du rouleau)
 *  - mirror : 2 faces tête-bêche (180°) à découper et coller séparément. (rouleau)
 *  - cut    : 2 faces dans le même sens, à découper en deux étiquettes. (4x6)
 *  - single : une seule face — sur le 4x6 elle occupe toute l'étiquette. (défaut 4x6)
 */
const path = require('node:path');
const fs = require('node:fs');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const bwipjs = require('bwip-js');
const { OWNERS, TAGS } = require('./constants');
const { DATA_DIR } = require('./db');

const FONT = 'Arial, "Segoe UI", sans-serif';
const tagById = Object.fromEntries(TAGS.map(t => [t.id, t]));

const mm = (v, dpi) => Math.round((v / 25.4) * dpi);
const num = (v, fallback) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : fallback);

/**
 * Répartition verticale d'une face, en fraction de la hauteur utile. Le code-barres
 * prend ce qui reste : aucune section ne peut donc déborder, quelle que soit la taille.
 *
 *  - compact : une face de bande rouleau fait ~38 mm de haut, tout est serré.
 *  - big     : sur du 4x6 il y a la place de lister le contenu et de grossir la
 *              destination, qui remonte juste sous le code pour être vue en premier.
 */
const LAYOUTS = {
  compact: {
    padMm: 2.5, gap: 0.024, ownerW: 0.30, minItemMm: 0, maxTagsMm: 5,
    order: ['head', 'content', 'dest', 'tags', 'barcode'],
    head: 0.21, content: 0.20, items: 0, dest: 0.135, tags: 0.095, caption: 0.055
  },
  big: {
    padMm: 5, gap: 0.018, ownerW: 0.30, minItemMm: 3.2,
    order: ['head', 'dest', 'content', 'items', 'tags', 'barcode'],
    head: 0.17, content: 0.12, items: 0.17, dest: 0.125, tags: 0.08, caption: 0.045
  }
};

/* ------------------------------------------------------------------ */
/* helpers texte                                                       */
/* ------------------------------------------------------------------ */

function setFont(ctx, px, weight = 'normal') {
  ctx.font = weight + ' ' + Math.round(px) + 'px ' + FONT;
}

/** Réduit la taille jusqu'à ce que le texte tienne sur une ligne. */
function fitOneLine(ctx, text, maxW, startPx, minPx, weight = 'bold') {
  let size = Math.round(startPx);
  while (size > minPx) {
    setFont(ctx, size, weight);
    if (ctx.measureText(text).width <= maxW) break;
    size -= 1;
  }
  setFont(ctx, size, weight);
  return size;
}

function wrap(ctx, text, maxW) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Coupe le texte à la largeur donnée, avec « … » si besoin (police déjà posée). */
function ellipsize(ctx, text, maxW) {
  let out = String(text);
  if (ctx.measureText(out).width <= maxW) return out;
  while (out.length > 1 && ctx.measureText(out + '…').width > maxW) out = out.slice(0, -1);
  return out + '…';
}

/** Cherche la plus grande taille qui tienne en `maxLines` lignes dans `maxW`. */
function fitWrapped(ctx, text, maxW, startPx, minPx, maxLines, weight = 'bold') {
  let size = Math.round(startPx);
  let lines = [];
  while (size > minPx) {
    setFont(ctx, size, weight);
    lines = wrap(ctx, text, maxW);
    if (lines.length <= maxLines) break;
    size -= 1;
  }
  setFont(ctx, size, weight);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1], maxW);
  }
  return { size, lines };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* pictogrammes vectoriels (noir pur, lisibles en thermique)           */
/* ------------------------------------------------------------------ */

function icon(ctx, name, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = Math.max(2, s * 0.1);
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (name) {
    case 'glass': { // verre à pied = FRAGILE
      ctx.beginPath();
      ctx.moveTo(s * 0.2, s * 0.06);
      ctx.lineTo(s * 0.8, s * 0.06);
      ctx.lineTo(s * 0.62, s * 0.46);
      ctx.lineTo(s * 0.38, s * 0.46);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.46); ctx.lineTo(s * 0.5, s * 0.84);
      ctx.moveTo(s * 0.24, s * 0.9); ctx.lineTo(s * 0.76, s * 0.9);
      ctx.stroke();
      break;
    }
    case 'up': { // flèches vers le haut
      for (const dx of [s * 0.28, s * 0.72]) {
        ctx.beginPath();
        ctx.moveTo(dx, s * 0.92); ctx.lineTo(dx, s * 0.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(dx - s * 0.17, s * 0.36);
        ctx.lineTo(dx, s * 0.06);
        ctx.lineTo(dx + s * 0.17, s * 0.36);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'weight': { // haltère
      ctx.fillRect(s * 0.06, s * 0.28, s * 0.15, s * 0.44);
      ctx.fillRect(s * 0.79, s * 0.28, s * 0.15, s * 0.44);
      ctx.fillRect(s * 0.21, s * 0.42, s * 0.58, s * 0.16);
      break;
    }
    case 'nostack': {
      ctx.beginPath(); ctx.arc(s * 0.5, s * 0.5, s * 0.42, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(s * 0.2, s * 0.8); ctx.lineTo(s * 0.8, s * 0.2); ctx.stroke();
      break;
    }
    case 'drop': {
      ctx.beginPath();
      ctx.moveTo(s * 0.5, s * 0.05);
      ctx.bezierCurveTo(s * 0.52, s * 0.4, s * 0.9, s * 0.52, s * 0.9, s * 0.68);
      ctx.arc(s * 0.5, s * 0.68, s * 0.4, 0, Math.PI);
      ctx.bezierCurveTo(s * 0.1, s * 0.52, s * 0.48, s * 0.4, s * 0.5, s * 0.05);
      ctx.fill();
      break;
    }
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.2 : s * 0.46;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const px = s * 0.5 + Math.cos(a) * r;
        const py = s * 0.5 + Math.sin(a) * r;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* rendu d'une face                                                     */
/* ------------------------------------------------------------------ */

/**
 * Rend le Code128 à une échelle ENTIÈRE de module afin que toutes les barres
 * gardent exactement la même largeur en pixels (indispensable pour un scan fiable
 * en 300 dpi thermique). Retourne l'image et sa largeur naturelle.
 */
async function barcodeImage(code, maxWidthPx) {
  const opts = {
    bcid: 'code128', text: code, includetext: false,
    paddingwidth: 0, paddingheight: 0, backgroundcolor: 'FFFFFF', height: 10
  };
  const probe = await loadImage(await bwipjs.toBuffer({ ...opts, scale: 1 }));
  const scale = Math.max(1, Math.min(12, Math.floor(maxWidthPx / probe.width)));
  const img = await loadImage(await bwipjs.toBuffer({ ...opts, scale }));
  return { img, width: Math.min(img.width, maxWidthPx) };
}

/** Le détail du contenu sous forme de liste : la grande étiquette a la place. */
function itemLabels(box) {
  if (Array.isArray(box.items) && box.items.length) {
    return box.items
      .map(i => String(i && i.label !== undefined ? i.label : i).trim())
      .filter(Boolean);
  }
  return String(box.subtitle || '').split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
}

function drawPanel(ctx, box, geo, bc) {
  const { W, H, dpi, layout: L } = geo;
  const pad = mm(L.padMm, dpi);
  const innerW = W - pad * 2;
  const owner = OWNERS[box.owner] || OWNERS.M;
  const tags = (box.tags || []).map(t => tagById[t]).filter(Boolean);
  const items = L.items ? itemLabels(box) : [];

  /* Budget vertical : tout est dérivé de la hauteur utile, le code-barres
     récupère l'espace restant. Aucune section ne peut donc déborder. */
  const usable = H - pad * 2;
  const gap = Math.round(usable * L.gap);
  const h = {
    head: Math.round(usable * L.head),
    dest: Math.round(usable * L.dest),
    content: Math.round(usable * L.content),
    items: items.length ? Math.round(usable * L.items) : 0,
    // Les pastilles grandissent avec la bande : au-delà, une seule tiendrait en largeur.
    tags: tags.length ? Math.min(Math.round(usable * L.tags), L.maxTagsMm ? mm(L.maxTagsMm, dpi) : Infinity) : 0,
    caption: Math.round(usable * L.caption)
  };
  const drawn = L.order.filter(k => k === 'barcode' || h[k] > 0);
  const used = drawn.reduce((sum, k) => sum + (k === 'barcode' ? h.caption : h[k]), 0);
  h.barcode = usable - used - gap * (drawn.length - 1);

  ctx.save();
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';

  let y = pad;

  /* ---- bandeau code + propriétaire ---- */
  const head = () => {
    const ownerW = Math.round(innerW * L.ownerW);
    roundRect(ctx, pad + innerW - ownerW, y, ownerW, h.head, h.head * 0.18);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    const kindText = box.kind === 'item' ? 'OBJET' : 'CARTON';
    const oSize = fitOneLine(ctx, owner.label, ownerW * 0.84, h.head * 0.42, 8, 'bold');
    const kindSize = fitOneLine(ctx, kindText, ownerW * 0.84, h.head * 0.26, 7, 'normal');
    const ownerBlockH = oSize * 1.2 + kindSize * 1.2;
    const oy = y + (h.head - ownerBlockH) / 2;
    setFont(ctx, oSize, 'bold');
    ctx.fillText(owner.label, pad + innerW - ownerW / 2, oy);
    setFont(ctx, kindSize, 'normal');
    ctx.fillText(kindText, pad + innerW - ownerW / 2, oy + oSize * 1.2);

    ctx.fillStyle = '#000';
    ctx.textAlign = 'left';
    const codeSize = fitOneLine(ctx, box.code, innerW - ownerW - pad, h.head * 0.92, 20, 'bold');
    ctx.fillText(box.code, pad, y + (h.head - codeSize * 1.18) / 2);
  };

  /* ---- destination ---- */
  const dest = () => {
    ctx.fillStyle = '#000';
    ctx.fillRect(pad, y, innerW, h.dest);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    const text = (box.destination || 'DESTINATION ?').toUpperCase();
    const dSize = fitOneLine(ctx, text, innerW * 0.94, h.dest * 0.66, 10, 'bold');
    ctx.fillText(text, pad + innerW * 0.03, y + (h.dest - dSize * 1.22) / 2);
    ctx.fillStyle = '#000';
  };

  /* ---- contenu ---- */
  const content = () => {
    const title = box.title || '(sans description)';
    const oneLinePx = Math.round(h.content * (h.items ? 0.78 : 0.62));
    setFont(ctx, oneLinePx, 'bold');
    let tSize, lines;
    if (ctx.measureText(title).width <= innerW) {
      tSize = oneLinePx; lines = [title];
    } else {
      ({ size: tSize, lines } = fitWrapped(ctx, title, innerW, Math.round(h.content * 0.55), 9, 2, 'bold'));
    }
    setFont(ctx, tSize, 'bold');
    // Sans liste dédiée (bande du rouleau), le détail se glisse sous un titre d'une ligne.
    const hasSub = !h.items && Boolean(box.subtitle) && lines.length === 1;
    const subSize = Math.max(9, Math.round(tSize * 0.55));
    const blockH = lines.length * tSize * 1.16 + (hasSub ? subSize * 1.3 : 0);
    let ty = y + Math.max(0, (h.content - blockH) / 2);
    for (const line of lines) { ctx.fillText(line, pad, ty); ty += tSize * 1.16; }
    if (hasSub) {
      setFont(ctx, subSize, 'normal');
      ctx.fillText(wrap(ctx, box.subtitle, innerW)[0] || '', pad, ty + subSize * 0.15);
    }
  };

  /* ---- détail du contenu, en liste (grandes étiquettes) ---- */
  const list = () => {
    const minLine = mm(L.minItemMm, dpi);
    const lineH = Math.max(minLine, Math.min(Math.round(h.items / 5), Math.round(h.items / items.length)));
    const rows = Math.max(1, Math.floor(h.items / lineH));
    const size = Math.round(lineH * 0.66);
    const shown = items.length > rows ? items.slice(0, rows - 1) : items.slice(0, rows);
    ctx.textAlign = 'left';
    let ly = y;
    setFont(ctx, size, 'normal');
    for (const label of shown) {
      ctx.fillText('• ' + ellipsize(ctx, label, innerW - size * 1.5), pad, ly + (lineH - size) / 2);
      ly += lineH;
    }
    if (items.length > shown.length) {
      setFont(ctx, size, 'bold');
      ctx.fillText('+ ' + (items.length - shown.length) + ' autres', pad, ly + (lineH - size) / 2);
    }
  };

  /* ---- sigles ---- */
  const sigles = () => {
    let tx = pad;
    ctx.lineWidth = Math.max(2, h.tags * 0.09);
    const fSize = Math.round(h.tags * 0.46);
    for (const tag of tags) {
      ctx.fillStyle = '#000';
      setFont(ctx, fSize, 'bold');
      const iconW = h.tags * 0.62;
      const pillW = ctx.measureText(tag.short).width + iconW + h.tags * 0.72;
      if (tx + pillW > pad + innerW) break;
      const filled = tag.id === 'fragile';
      roundRect(ctx, tx, y, pillW, h.tags, h.tags * 0.3);
      if (filled) { ctx.fill(); ctx.fillStyle = '#fff'; }
      else { ctx.strokeStyle = '#000'; ctx.stroke(); }
      icon(ctx, tag.icon, tx + h.tags * 0.2, y + (h.tags - iconW) / 2, iconW);
      ctx.textAlign = 'left';
      ctx.fillText(tag.short, tx + iconW + h.tags * 0.38, y + (h.tags - fSize * 1.2) / 2);
      tx += pillW + h.tags * 0.22;
    }
    ctx.fillStyle = '#000';
  };

  /* ---- code-barres ---- */
  const barcode = () => {
    const clear = Math.round(usable * 0.035);   // silence sous les barres
    ctx.fillStyle = '#fff';
    ctx.fillRect(pad, y, innerW, h.barcode);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bc.img, pad + (innerW - bc.width) / 2, y, bc.width, Math.max(1, h.barcode - clear));

    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    setFont(ctx, Math.round(h.caption * 0.85), 'bold');
    ctx.fillText(box.code, pad + innerW / 2, y + h.barcode);
  };

  const draw = { head, dest, content, items: list, tags: sigles, barcode };
  drawn.forEach((key, i) => {
    draw[key]();
    y += (key === 'barcode' ? h.barcode + h.caption : h[key]) + (i < drawn.length - 1 ? gap : 0);
  });

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* rendu de l'étiquette complète                                       */
/* ------------------------------------------------------------------ */

/**
 * Dimensions nominales de l'étiquette, dérivées des réglages. Référence unique,
 * partagée par le rendu, le choix du format pilote et l'écran de réglages.
 *
 * Rouleau : la longueur découle des faces (bande continue, on coupe où on veut).
 * 4x6 : la taille est imposée par l'étiquette prédécoupée, ce sont les faces qui
 * se partagent la hauteur disponible.
 */
function labelSize(settings) {
  const format = settings.labelFormat === 'shipping' ? 'shipping' : 'roll';
  const gapOf = v => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 12);

  if (format === 'shipping') {
    const mode = ['single', 'fold', 'cut'].includes(settings.shippingMode) ? settings.shippingMode : 'single';
    const panels = mode === 'single' ? 1 : 2;
    const widthMm = num(settings.shippingWidthMm, 101.6);
    const heightMm = num(settings.shippingHeightMm, 152.4);
    // La zone de pli est prise SUR l'étiquette : elle ne peut pas l'allonger.
    const gapMm = mode === 'fold' ? Math.min(gapOf(settings.shippingFoldGapMm), heightMm * 0.25) : 0;
    return { format, mode, panels, gapMm, widthMm, heightMm, panelHeightMm: (heightMm - gapMm) / panels };
  }

  const mode = ['fold', 'mirror', 'single'].includes(settings.labelMode) ? settings.labelMode : 'fold';
  const panels = mode === 'single' ? 1 : 2;
  const gapMm = panels === 1 ? 0 : gapOf(settings.foldGapMm);
  const panelHeightMm = num(settings.panelHeightMm, 43);
  return {
    format, mode, panels, gapMm,
    widthMm: num(settings.labelWidthMm, 62),
    heightMm: panelHeightMm * panels + gapMm,
    panelHeightMm
  };
}

/** Réduit l'étiquette pour tenir dans la zone imprimable, sans toucher au reste. */
function scaleSettings(settings, scale) {
  const keys = settings.labelFormat === 'shipping'
    ? ['shippingWidthMm', 'shippingHeightMm', 'shippingFoldGapMm']
    : ['labelWidthMm', 'panelHeightMm', 'foldGapMm'];
  const out = { ...settings };
  for (const k of keys) out[k] = Number(settings[k]) * scale;
  return out;
}

async function renderLabel(box, settings) {
  const dpi = num(settings.dpi, 300);
  const size = labelSize(settings);
  const W = mm(size.widthMm, dpi);
  const panelH = mm(size.panelHeightMm, dpi);
  const gap = mm(size.gapMm, dpi);
  const H = panelH * size.panels + gap;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);

  const layout = LAYOUTS[size.format === 'shipping' ? 'big' : 'compact'];
  const geo = { W, H: panelH, dpi, layout };
  const bc = await barcodeImage(box.code, W - mm(layout.padMm, dpi) * 2);

  // Face 1 (haut)
  ctx.save();
  if (size.mode === 'mirror') {
    ctx.translate(W, panelH);
    ctx.rotate(Math.PI);
  }
  drawPanel(ctx, box, geo, bc);
  ctx.restore();

  if (size.panels === 2) {
    const sy = panelH + gap / 2;
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.fillStyle = '#000';
    ctx.lineWidth = Math.max(1, Math.round(dpi / 150));

    if (size.mode === 'fold' && gap >= mm(6, dpi)) {
      /* Zone blanche : rien ne doit tomber sur l'arête du carton. On repère le pli
         par deux amorces sur les bords, le centre reste vierge. */
      const tick = mm(5, dpi);
      ctx.beginPath();
      ctx.moveTo(0, sy); ctx.lineTo(tick, sy);
      ctx.moveTo(W - tick, sy); ctx.lineTo(W, sy);
      ctx.stroke();
      setFont(ctx, mm(2.1, dpi), 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('PLIER SUR L’ARETE', W / 2, sy - mm(1.6, dpi));
    } else {
      /* Zone étroite (ou mode découpe) : un trait pointillé complet est plus lisible. */
      ctx.setLineDash([mm(1.6, dpi), mm(1.6, dpi)]);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke();
      ctx.setLineDash([]);
      setFont(ctx, mm(2.2, dpi), 'bold');
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const legend = size.mode === 'fold' ? '  PLIER SUR L’ARETE  ' : '  DECOUPER ICI  ';
      const lw = ctx.measureText(legend).width;
      ctx.fillStyle = '#fff';
      ctx.fillRect((W - lw) / 2, sy - mm(1.5, dpi), lw, mm(3, dpi));
      ctx.fillStyle = '#000';
      ctx.fillText(legend, W / 2, sy);
    }
    ctx.restore();

    // Face 2 (bas)
    ctx.save();
    ctx.translate(0, panelH + gap);
    drawPanel(ctx, box, geo, bc);
    ctx.restore();
  }

  return {
    buffer: canvas.toBuffer('image/png'),
    format: size.format,
    widthMm: size.widthMm,
    heightMm: (H / dpi) * 25.4
  };
}

async function renderLabelToFile(box, settings) {
  const res = await renderLabel(box, settings);
  const suffix = res.format === 'shipping' ? '-4x6' : '';
  const file = path.join(DATA_DIR, 'labels', box.code + suffix + '.png');
  fs.writeFileSync(file, res.buffer);
  return Object.assign({}, res, { file });
}

module.exports = { renderLabel, renderLabelToFile, labelSize, scaleSettings };
