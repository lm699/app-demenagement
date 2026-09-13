'use strict';
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const express = require('express');
const multer = require('multer');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const { db, allSettings, setSetting, DATA_DIR, DEFAULT_SETTINGS } = require('./db');
const { OWNERS, TAGS, STATUSES, KINDS, LABEL_FORMATS, LABEL_FORMAT_IDS } = require('./constants');
const { renderLabel } = require('./label');
const printer = require('./printer');

const HTTP_PORT = Number(process.env.PORT || 3000);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 3443);
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.disable('x-powered-by');

const now = () => new Date().toISOString();
const asUser = req => String(req.get('X-User') || '').slice(0, 40);

/* ------------------------------------------------------------------ */
/* SSE : le PC voit en direct ce que le mobile crée                    */
/* ------------------------------------------------------------------ */

const clients = new Set();
function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch { /* client parti */ } }
}
printer.setListener(broadcast);

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);
  const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

/* ------------------------------------------------------------------ */
/* helpers cartons                                                     */
/* ------------------------------------------------------------------ */

const OWNER_CODES = Object.keys(OWNERS);
const TAG_IDS = new Set(TAGS.map(t => t.id));
const STATUS_IDS = new Set(STATUSES.map(s => s.id));

function cleanTags(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter(t => TAG_IDS.has(t)))];
}

function hydrate(row, { withPhotos = true, withItems = true } = {}) {
  if (!row) return null;
  const out = {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    ownerName: (OWNERS[row.owner] || {}).name || row.owner
  };
  if (withPhotos) {
    out.photos = db.prepare(
      'SELECT id, file, thumb, created_at FROM photos WHERE container_id = ? ORDER BY id'
    ).all(row.id);
  }
  if (withItems) {
    out.items = db.prepare(
      'SELECT id, label, qty FROM items WHERE container_id = ? ORDER BY position, id'
    ).all(row.id);
  }
  return out;
}

function nextCode(owner) {
  const row = db.prepare('SELECT MAX(seq) AS m FROM containers WHERE owner = ?').get(owner);
  const seq = (row && row.m ? row.m : 0) + 1;
  return { seq, code: `${owner}-${String(seq).padStart(3, '0')}` };
}

/* ------------------------------------------------------------------ */
/* méta / réglages                                                     */
/* ------------------------------------------------------------------ */

app.get('/api/meta', (req, res) => {
  res.json({
    owners: OWNERS, tags: TAGS, statuses: STATUSES, kinds: KINDS,
    labelFormats: LABEL_FORMATS,
    settings: allSettings(),
    addresses: localAddresses(),
    secure: req.secure
  });
});

app.get('/api/settings', (req, res) => res.json(allSettings()));

/* Bornes des réglages numériques : une valeur aberrante (saisie de travers, molette
   sur un champ) rendrait toutes les impressions suivantes inutilisables. */
const NUMERIC_RANGES = {
  labelWidthMm: [12, 120],
  panelHeightMm: [20, 150],
  foldGapMm: [0, 60],
  offsetXMm: [-20, 20],
  offsetYMm: [-20, 20],
  shippingWidthMm: [40, 220],
  shippingHeightMm: [40, 320],
  shippingFoldGapMm: [0, 60],
  shippingOffsetXMm: [-20, 20],
  shippingOffsetYMm: [-20, 20],
  dpi: [150, 600],
  kitSmallCopies: [0, 6]
};

/* Les réglages à choix fermé : une valeur inconnue ferait silencieusement retomber
   le rendu sur son défaut, donc on la refuse tout de suite. */
const ENUM_VALUES = {
  labelFormat: LABEL_FORMAT_IDS,
  labelMode: ['fold', 'mirror', 'single'],
  shippingMode: ['single', 'fold', 'cut']
};

app.put('/api/settings', (req, res) => {
  const body = req.body || {};
  const rejected = [];
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (!(key in body)) continue;
    let v = body[key];
    if (key === 'destinations' || key === 'quickTitlesPerso' || key === 'quickTitlesMixte') {
      v = JSON.stringify((Array.isArray(v) ? v : []).map(s => String(s).trim()).filter(Boolean));
    } else if (key === 'autoPrintOnClose' || key === 'kitOnClose' || key === 'rollFillLength') {
      v = v ? 1 : 0;
    } else if (ENUM_VALUES[key]) {
      if (!ENUM_VALUES[key].includes(String(v))) { rejected.push(key); continue; }
      v = String(v);
    } else if (NUMERIC_RANGES[key]) {
      const [min, max] = NUMERIC_RANGES[key];
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) { rejected.push(key); continue; }
      v = n;
    }
    setSetting(key, v);
  }
  if (rejected.length) {
    return res.status(400).json({
      error: `Valeur hors limites : ${rejected.join(', ')}`,
      settings: allSettings()
    });
  }
  const s = allSettings();
  broadcast({ type: 'settings', settings: s });
  res.json(s);
});

app.get('/api/printers', async (req, res) => res.json(await printer.listPrinters()));
app.get('/api/papers', async (req, res) => res.json(await printer.listPapers(String(req.query.printer || ''))));

/**
 * Ce qui sortira réellement de l'imprimante pour des réglages donnés : format du
 * pilote retenu et taille finale une fois ajustée à la zone imprimable.
 */
app.get('/api/paper-match', async (req, res) => {
  const base = allSettings();
  for (const k of [
    'labelWidthMm', 'panelHeightMm', 'foldGapMm',
    'shippingWidthMm', 'shippingHeightMm', 'shippingFoldGapMm'
  ]) {
    const v = Number(req.query[k]);
    if (Number.isFinite(v) && v > 0) base[k] = v;
  }
  if (req.query.labelMode) base.labelMode = String(req.query.labelMode);
  if (req.query.rollFillLength !== undefined) {
    base.rollFillLength = ['1', 'true'].includes(String(req.query.rollFillLength)) ? 1 : 0;
  }
  if (req.query.shippingMode) base.shippingMode = String(req.query.shippingMode);
  const s = printer.forFormat(base, String(req.query.format || base.labelFormat));
  if (req.query.printer) s.printer = String(req.query.printer);
  try {
    const plan = await printer.planPrint(s);
    res.json({
      format: s.labelFormat,
      printer: s.printer,
      paper: plan.paper,
      nominal: plan.nominal,
      printed: plan.printed,
      scale: plan.scale
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/* ------------------------------------------------------------------ */
/* cartons                                                             */
/* ------------------------------------------------------------------ */

app.get('/api/containers', (req, res) => {
  const { q, owner, destination, status, kind, tag } = req.query;
  const where = [];
  const args = [];

  if (owner && OWNERS[owner]) { where.push('c.owner = ?'); args.push(owner); }
  if (destination) { where.push('c.destination = ?'); args.push(String(destination)); }
  if (status && STATUS_IDS.has(status)) { where.push('c.status = ?'); args.push(status); }
  if (kind) { where.push('c.kind = ?'); args.push(String(kind)); }
  if (tag && TAG_IDS.has(tag)) { where.push("c.tags LIKE ?"); args.push(`%"${tag}"%`); }
  if (q) {
    const like = `%${String(q).trim()}%`;
    where.push(`(c.code LIKE ? OR c.title LIKE ? OR c.notes LIKE ? OR c.destination LIKE ?
                 OR EXISTS (SELECT 1 FROM items i WHERE i.container_id = c.id AND i.label LIKE ?))`);
    args.push(like, like, like, like, like);
  }

  const rows = db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM photos p WHERE p.container_id = c.id) AS photo_count,
           (SELECT COUNT(*) FROM items  i WHERE i.container_id = c.id) AS item_count,
           (SELECT thumb FROM photos p WHERE p.container_id = c.id ORDER BY p.id LIMIT 1) AS cover
    FROM containers c
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.updated_at DESC
    LIMIT 500
  `).all(...args);

  res.json(rows.map(r => hydrate(r, { withPhotos: false, withItems: false })));
});

app.get('/api/containers/:ref', (req, res) => {
  const ref = String(req.params.ref);
  const row = /^\d+$/.test(ref)
    ? db.prepare('SELECT * FROM containers WHERE id = ?').get(Number(ref))
    : db.prepare('SELECT * FROM containers WHERE UPPER(code) = ?').get(ref.toUpperCase());
  if (!row) return res.status(404).json({ error: 'Introuvable' });
  res.json(hydrate(row));
});

app.post('/api/containers', (req, res) => {
  const b = req.body || {};
  const owner = OWNER_CODES.includes(b.owner) ? b.owner : 'M';
  const kind = b.kind === 'item' ? 'item' : 'box';
  const user = asUser(req) || b.created_by || '';

  let row;
  try {
    const { seq, code } = nextCode(owner);
    const info = db.prepare(`
      INSERT INTO containers (code, seq, owner, kind, title, notes, destination, origin, tags,
                              status, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      code, seq, owner, kind,
      String(b.title || '').slice(0, 200),
      String(b.notes || '').slice(0, 2000),
      String(b.destination || '').slice(0, 80),
      String(b.origin || '').slice(0, 80),
      JSON.stringify(cleanTags(b.tags)),
      STATUS_IDS.has(b.status) ? b.status : 'open',
      user, now(), now()
    );
    row = db.prepare('SELECT * FROM containers WHERE id = ?').get(Number(info.lastInsertRowid));
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }

  if (Array.isArray(b.items)) {
    const stmt = db.prepare('INSERT INTO items (container_id, label, qty, position) VALUES (?,?,?,?)');
    b.items.map(s => String(s).trim()).filter(Boolean)
      .forEach((label, i) => stmt.run(row.id, label.slice(0, 120), 1, i));
  }

  const full = hydrate(row);
  broadcast({ type: 'container', action: 'create', container: full });
  res.status(201).json(full);
});

app.patch('/api/containers/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM containers WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'Introuvable' });

  const b = req.body || {};
  const fields = {};
  if (typeof b.title === 'string') fields.title = b.title.slice(0, 200);
  if (typeof b.notes === 'string') fields.notes = b.notes.slice(0, 2000);
  if (typeof b.destination === 'string') fields.destination = b.destination.slice(0, 80);
  if (typeof b.origin === 'string') fields.origin = b.origin.slice(0, 80);
  if (b.kind === 'box' || b.kind === 'item') fields.kind = b.kind;
  if (Array.isArray(b.tags)) fields.tags = JSON.stringify(cleanTags(b.tags));
  if (STATUS_IDS.has(b.status)) {
    fields.status = b.status;
    if (b.status !== 'open' && !cur.closed_at) fields.closed_at = now();
  }
  // Changer de propriétaire renumérote le carton : le code doit rester vrai.
  if (OWNER_CODES.includes(b.owner) && b.owner !== cur.owner) {
    const { seq, code } = nextCode(b.owner);
    fields.owner = b.owner; fields.seq = seq; fields.code = code;
  }

  const keys = Object.keys(fields);
  if (keys.length) {
    db.prepare(`UPDATE containers SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...keys.map(k => fields[k]), now(), id);
  }
  const full = hydrate(db.prepare('SELECT * FROM containers WHERE id = ?').get(id));
  broadcast({ type: 'container', action: 'update', container: full });
  res.json(full);
});

app.delete('/api/containers/:id', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM containers WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Introuvable' });
  for (const p of db.prepare('SELECT file, thumb FROM photos WHERE container_id = ?').all(id)) {
    for (const f of [p.file, p.thumb]) {
      if (f) try { fs.unlinkSync(path.join(DATA_DIR, 'photos', f)); } catch {}
    }
  }
  db.prepare('DELETE FROM containers WHERE id = ?').run(id);
  broadcast({ type: 'container', action: 'delete', id, code: row.code });
  res.json({ ok: true });
});

/**
 * Fermeture : passe en « fermé » et lance l'impression (réglage autoPrintOnClose).
 *
 * Par défaut c'est le KIT complet qui part : la grande 4x6 pour la face avant, plus
 * N bandes rouleau pour les autres côtés du carton. `kit: false` dans le corps de la
 * requête retombe sur une seule étiquette, dans le format demandé ou celui par défaut.
 */
app.post('/api/containers/:id/close', (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM containers WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Introuvable' });

  db.prepare("UPDATE containers SET status = 'closed', closed_at = COALESCE(closed_at, ?), updated_at = ? WHERE id = ?")
    .run(now(), now(), id);
  const full = hydrate(db.prepare('SELECT * FROM containers WHERE id = ?').get(id));
  broadcast({ type: 'container', action: 'update', container: full });

  const s = allSettings();
  const b = req.body || {};
  const wantPrint = b.print !== undefined ? Boolean(b.print) : Boolean(s.autoPrintOnClose);
  const wantKit = b.kit !== undefined ? Boolean(b.kit) : Boolean(s.kitOnClose);

  let jobs = [];
  if (wantPrint) {
    jobs = wantKit ? printer.enqueueKit(full, asUser(req)) : [printer.enqueue(full, asUser(req), b.format)];
  }
  // `job` reste renseigné : un mobile dont le service worker sert encore l'ancienne
  // page ne connaît pas `jobs` et afficherait « fermé » sans parler de l'étiquette.
  res.json({ container: full, jobs, job: jobs[0] || null });
});

/* ------------------------------------------------------------------ */
/* contenu détaillé                                                    */
/* ------------------------------------------------------------------ */

app.post('/api/containers/:id/items', (req, res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM containers WHERE id = ?').get(id)) {
    return res.status(404).json({ error: 'Introuvable' });
  }
  const labels = (Array.isArray(req.body.labels) ? req.body.labels : [req.body.label])
    .map(s => String(s || '').trim()).filter(Boolean);
  const base = db.prepare('SELECT COALESCE(MAX(position), -1) AS p FROM items WHERE container_id = ?').get(id).p;
  const stmt = db.prepare('INSERT INTO items (container_id, label, qty, position) VALUES (?,?,?,?)');
  labels.forEach((l, i) => stmt.run(id, l.slice(0, 120), 1, base + 1 + i));
  db.prepare('UPDATE containers SET updated_at = ? WHERE id = ?').run(now(), id);
  const full = hydrate(db.prepare('SELECT * FROM containers WHERE id = ?').get(id));
  broadcast({ type: 'container', action: 'update', container: full });
  res.json(full);
});

app.delete('/api/items/:id', (req, res) => {
  const item = db.prepare('SELECT * FROM items WHERE id = ?').get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Introuvable' });
  db.prepare('DELETE FROM items WHERE id = ?').run(item.id);
  const full = hydrate(db.prepare('SELECT * FROM containers WHERE id = ?').get(item.container_id));
  broadcast({ type: 'container', action: 'update', container: full });
  res.json(full);
});

/* ------------------------------------------------------------------ */
/* photos                                                              */
/* ------------------------------------------------------------------ */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 12 }
});

async function saveImage(buffer, baseName) {
  const dir = path.join(DATA_DIR, 'photos');
  let full, thumb;
  try {
    const img = await loadImage(buffer);
    const write = (maxSide, quality, suffix) => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const cv = createCanvas(w, h);
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      const name = `${baseName}${suffix}.jpg`;
      fs.writeFileSync(path.join(dir, name), cv.toBuffer('image/jpeg', quality));
      return name;
    };
    full = write(1600, 80, '');
    thumb = write(420, 72, '_t');
  } catch {
    // Format non décodable (HEIC…) : on conserve l'original tel quel.
    full = `${baseName}.bin`;
    fs.writeFileSync(path.join(dir, full), buffer);
    thumb = full;
  }
  return { full, thumb };
}

app.post('/api/containers/:id/photos', upload.array('photos', 12), async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM containers WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Introuvable' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Aucune photo reçue' });

  const stmt = db.prepare('INSERT INTO photos (container_id, file, thumb, created_at) VALUES (?,?,?,?)');
  for (const f of files) {
    const base = `${row.code}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const { full, thumb } = await saveImage(f.buffer, base);
    stmt.run(id, full, thumb, now());
  }
  db.prepare('UPDATE containers SET updated_at = ? WHERE id = ?').run(now(), id);
  const out = hydrate(db.prepare('SELECT * FROM containers WHERE id = ?').get(id));
  broadcast({ type: 'container', action: 'update', container: out });
  res.json(out);
});

app.delete('/api/photos/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM photos WHERE id = ?').get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'Introuvable' });
  for (const f of new Set([p.file, p.thumb])) {
    try { fs.unlinkSync(path.join(DATA_DIR, 'photos', f)); } catch {}
  }
  db.prepare('DELETE FROM photos WHERE id = ?').run(p.id);
  const out = hydrate(db.prepare('SELECT * FROM containers WHERE id = ?').get(p.container_id));
  broadcast({ type: 'container', action: 'update', container: out });
  res.json(out);
});

/* ------------------------------------------------------------------ */
/* étiquettes : aperçu + impression                                    */
/* ------------------------------------------------------------------ */

app.get('/api/containers/:id/label.png', async (req, res) => {
  const row = db.prepare('SELECT * FROM containers WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).end();
  const s = allSettings();
  if (req.query.format) s.labelFormat = String(req.query.format);
  if (req.query.mode) {
    if (s.labelFormat === 'shipping') s.shippingMode = String(req.query.mode);
    else s.labelMode = String(req.query.mode);
  }
  const items = db.prepare('SELECT label FROM items WHERE container_id = ? ORDER BY position, id LIMIT 8')
    .all(row.id).map(r => r.label);
  try {
    const out = await renderLabel({
      code: row.code, owner: row.owner, kind: row.kind, title: row.title,
      subtitle: items.join(', '), items, destination: row.destination,
      tags: JSON.parse(row.tags || '[]')
    }, s);
    res.set('Content-Type', 'image/png').set('Cache-Control', 'no-store').send(out.buffer);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** Aperçu « à blanc » pour l'écran de réglages, sans créer de carton. */
app.post('/api/label/preview.png', async (req, res) => {
  const s = allSettings();
  const b = req.body || {};
  for (const k of [
    'labelFormat', 'labelMode', 'labelWidthMm', 'panelHeightMm', 'foldGapMm',
    'shippingMode', 'shippingWidthMm', 'shippingHeightMm', 'shippingFoldGapMm', 'dpi'
  ]) {
    if (b[k] !== undefined && b[k] !== '') s[k] = isNaN(Number(b[k])) ? b[k] : Number(b[k]);
  }
  /* La grande étiquette liste le contenu : sans exemple, son aperçu sonnerait creux. */
  const demoItems = Array.isArray(b.items) && b.items.length
    ? b.items.map(String)
    : ['Assiettes plates', 'Verres à pied', 'Bols', 'Plat à gratin', 'Carafe'];
  /* L'aperçu doit montrer la bande telle qu'elle sortira : sur le rouleau, c'est le
     format du pilote qui impose la longueur, pas la hauteur de face demandée. */
  let shown = s;
  try {
    const prof = printer.forFormat(s, s.labelFormat);
    if (prof.printer) shown = (await printer.planPrint(prof)).settings;
  } catch { /* pilote muet : on garde les réglages demandés */ }
  try {
    const out = await renderLabel({
      code: b.code || 'L-042', owner: b.owner || 'L', kind: b.kind || 'box',
      title: b.title || 'Vaisselle et verres du buffet',
      subtitle: b.subtitle !== undefined ? b.subtitle : demoItems.join(', '),
      items: demoItems,
      destination: b.destination || 'Cuisine',
      tags: cleanTags(b.tags || ['fragile', 'haut'])
    }, shown);
    res.set('Content-Type', 'image/png').set('Cache-Control', 'no-store').send(out.buffer);
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

/** QR code d'accès : ouvrir l'app sur le téléphone sans taper l'adresse. */
app.get('/api/qr.png', async (req, res) => {
  try {
    const QR = require('qrcode');
    const buf = await QR.toBuffer(String(req.query.text || ''), {
      type: 'png', width: 320, margin: 1, errorCorrectionLevel: 'M'
    });
    res.set('Content-Type', 'image/png').set('Cache-Control', 'public, max-age=3600').send(buf);
  } catch (e) {
    res.status(500).end();
  }
});

app.get('/api/print', (req, res) => res.json(printer.listJobs()));

app.post('/api/print/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM containers WHERE id = ?').get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: 'Introuvable' });
  const b = req.body || {};
  const copies = Math.min(5, Math.max(1, Number(b.copies) || 1));
  const jobs = [];
  for (let i = 0; i < copies; i++) jobs.push(printer.enqueue(row, asUser(req), b.format));
  res.json(jobs);
});

app.post('/api/print/job/:id/retry', (req, res) => {
  const j = printer.retry(Number(req.params.id));
  if (!j) return res.status(404).json({ error: 'Introuvable' });
  res.json(j);
});

app.delete('/api/print/job/:id', (req, res) => {
  if (!printer.cancel(Number(req.params.id))) {
    return res.status(409).json({ error: 'Impression en cours, impossible d’annuler' });
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* statistiques                                                        */
/* ------------------------------------------------------------------ */

app.get('/api/stats', (req, res) => {
  res.json({
    total: db.prepare('SELECT COUNT(*) c FROM containers').get().c,
    byStatus: db.prepare('SELECT status, COUNT(*) c FROM containers GROUP BY status').all(),
    byOwner: db.prepare('SELECT owner, COUNT(*) c FROM containers GROUP BY owner').all(),
    byDestination: db.prepare(
      'SELECT destination, COUNT(*) c FROM containers WHERE destination <> \'\' GROUP BY destination ORDER BY c DESC'
    ).all(),
    byKind: db.prepare('SELECT kind, COUNT(*) c FROM containers GROUP BY kind').all(),
    photos: db.prepare('SELECT COUNT(*) c FROM photos').get().c,
    queued: db.prepare("SELECT COUNT(*) c FROM print_jobs WHERE status IN ('queued','printing')").get().c,
    failed: db.prepare("SELECT COUNT(*) c FROM print_jobs WHERE status = 'error'").get().c
  });
});

/** Export complet (sauvegarde / inventaire papier). */
app.get('/api/export.json', (req, res) => {
  const rows = db.prepare('SELECT * FROM containers ORDER BY owner, seq').all().map(r => hydrate(r));
  res.set('Content-Disposition', 'attachment; filename="inventaire-demenagement.json"');
  res.json({ exportedAt: now(), containers: rows });
});

app.get('/api/export.csv', (req, res) => {
  const rows = db.prepare('SELECT * FROM containers ORDER BY owner, seq').all().map(r => hydrate(r));
  const esc = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['Code', 'Type', 'Proprietaire', 'Contenu', 'Detail', 'Destination', 'Sigles', 'Statut', 'Notes', 'Photos', 'Cree le'].join(';')];
  for (const r of rows) {
    lines.push([
      r.code, r.kind === 'item' ? 'Objet' : 'Carton', r.ownerName, r.title,
      r.items.map(i => i.label).join(', '), r.destination, r.tags.join(', '),
      r.status, r.notes, r.photos.length, r.created_at
    ].map(esc).join(';'));
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="inventaire-demenagement.csv"');
  res.send('﻿' + lines.join('\r\n'));
});

/* ------------------------------------------------------------------ */
/* fichiers statiques                                                  */
/* ------------------------------------------------------------------ */

app.use('/photos', express.static(path.join(DATA_DIR, 'photos'), { maxAge: '7d' }));
app.use('/labels', express.static(path.join(DATA_DIR, 'labels'), { maxAge: 0 }));
app.use('/vendor', express.static(path.join(__dirname, '..', 'node_modules', '@zxing', 'library', 'umd')));
app.use(express.static(PUBLIC_DIR, { maxAge: 0, extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.use((err, req, res, _next) => {
  console.error('[erreur]', err.message);
  res.status(500).json({ error: String(err.message || err) });
});

/* ------------------------------------------------------------------ */
/* démarrage                                                           */
/* ------------------------------------------------------------------ */

function localAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

/**
 * Certificat auto-signé, nécessaire pour le scan caméra en direct sur mobile
 * (contexte sécurisé). Chaque téléphone doit accepter l'avertissement une fois.
 *
 * On ne le régénère que s'il ne couvre PAS une des IP actuelles : le remplacer dès
 * que la liste change à un caractère près (une IP Ethernet, Bluetooth ou VPN qui
 * apparaît le temps d'un redémarrage) obligerait à réaccepter l'avertissement sur
 * chaque téléphone — et une app déjà installée échoue alors sans rien expliquer.
 * Le nouveau certificat reprend aussi les anciennes IP, pour rester valable si
 * l'interface qui manquait revient.
 */
async function ensureCert(ips) {
  const file = path.join(DATA_DIR, 'cert.json');
  let known = [];
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    known = String(c.ips || '').split(',').filter(Boolean);
    const covers = ips.every(ip => known.includes(ip));
    if (c.key && c.cert && covers && new Date(c.expires) > new Date()) return c;
  } catch {}

  const all = [...new Set([...known, ...ips])];
  const wanted = all.join(',');
  const selfsigned = require('selfsigned');
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }];
  for (const ip of all) altNames.push({ type: 7, ip });

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'demenagement.local' }],
    {
      days: 3650, keySize: 2048, algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, keyCertSign: true },
        { name: 'extKeyUsage', serverAuth: true },
        { name: 'subjectAltName', altNames }
      ]
    }
  );
  // On relit la date de fin dans le certificat lui-même : selon la version de
  // `selfsigned`, la durée demandée n'est pas forcément celle appliquée.
  const validTo = new crypto.X509Certificate(pems.cert).validTo;
  const cert = { key: pems.private, cert: pems.cert, ips: wanted, expires: new Date(validTo).toISOString() };
  fs.writeFileSync(file, JSON.stringify(cert));
  return cert;
}

printer.recover();

/* Cas courant : on relance Demarrer.bat alors que le serveur tourne deja.
   Sans ca, Node crache une trace d'exception illisible. */
function portOccupe(nom, port, e) {
  if (e.code !== 'EADDRINUSE') throw e;
  console.log('');
  console.log(`  ⚠️  Le port ${port} (${nom}) est deja utilise.`);
  console.log('     Le serveur tourne probablement deja : ouvre http://localhost:' + HTTP_PORT);
  console.log("     Sinon, ferme l'autre fenetre du serveur puis relance Demarrer.bat.");
  console.log('');
  process.exit(1);
}

const httpServer = http.createServer(app);
httpServer.on('error', e => portOccupe('interface web', HTTP_PORT, e));
httpServer.listen(HTTP_PORT, '0.0.0.0', async () => {
  const ips = localAddresses();
  console.log('');
  console.log('  📦  Déménagement — serveur démarré');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  PC       : http://localhost:${HTTP_PORT}`);
  for (const ip of ips) console.log(`  Mobile   : http://${ip}:${HTTP_PORT}`);
  try {
    const c = await ensureCert(ips);
    const httpsServer = https.createServer({ key: c.key, cert: c.cert }, app);
    httpsServer.on('error', e => portOccupe('scan camera', HTTPS_PORT, e));
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      for (const ip of ips) console.log(`  Scan live: https://${ip}:${HTTPS_PORT}  (accepter l'avertissement)`);
      console.log('  ─────────────────────────────────────────────');
      console.log('');
    });
  } catch (e) {
    console.log(`  (HTTPS indisponible : ${e.message})`);
    console.log('  ─────────────────────────────────────────────');
  }
});
