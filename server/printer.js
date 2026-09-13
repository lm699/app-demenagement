'use strict';
/**
 * File d'impression : un seul job à la fois, réessai manuel, aucun job perdu.
 * L'impression passe par System.Drawing (script PowerShell), sans dépendance externe.
 */
const path = require('node:path');
const { execFile } = require('node:child_process');
const { db, allSettings } = require('./db');
const { renderLabelToFile, labelSize, scaleSettings } = require('./label');
const { LABEL_FORMAT_IDS } = require('./constants');

const PS_SCRIPT = path.join(__dirname, 'print-image.ps1');
const PS_EXE = 'powershell.exe';

/** PowerShell crache une trace verbeuse : on ne garde que la phrase utile. */
function psError(stderr, stdout, err) {
  const lines = String(stderr || stdout || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !/^(\+|At |\s*~+$|CategoryInfo|FullyQualifiedErrorId)/.test(l));
  const msg = lines.find(l => !/^Au caractère|^In [A-Z]:/.test(l));
  if (msg) return msg.replace(/^\S+\s*:\s*/, '').slice(0, 300);
  if (err && err.killed) return 'Délai dépassé : imprimante hors ligne ou pilote bloqué';
  return (err && err.message) || 'Échec de l’impression';
}

function runPs(args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    execFile(
      PS_EXE,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT, ...args],
      { timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(psError(stderr, stdout, err)));
        resolve(String(stdout).trim());
      }
    );
  });
}

async function listPrinters() {
  try {
    return JSON.parse(await runPs(['-ListPrinters'], 15000));
  } catch {
    return [];
  }
}

async function listPapers(printer) {
  if (!printer) return [];
  try {
    return JSON.parse(await runPs(['-ListPapers', '-Printer', printer], 15000));
  } catch {
    return [];
  }
}

/* Interroger le pilote coûte ~1 s : on garde la liste en mémoire. */
const paperCache = new Map();
async function papersFor(printer, maxAgeMs = 120000) {
  const hit = paperCache.get(printer);
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.papers;
  const papers = await listPapers(printer);
  if (papers.length) paperCache.set(printer, { at: Date.now(), papers });
  return papers;
}

/* ------------------------------------------------------------------ */
/* profils d'impression                                                */
/* ------------------------------------------------------------------ */

/**
 * Chaque format a sa propre imprimante, son format pilote et ses recalages. Pour que
 * tout le reste du fichier n'ait qu'un seul jeu de champs à connaître, on ramène le
 * profil demandé sur les clés génériques (`printer`, `paperName`, `offset*Mm`).
 */
function forFormat(settings, format) {
  const id = LABEL_FORMAT_IDS.includes(format) ? format : (
    LABEL_FORMAT_IDS.includes(settings.labelFormat) ? settings.labelFormat : 'roll'
  );
  if (id !== 'shipping') return { ...settings, labelFormat: 'roll' };
  return {
    ...settings,
    labelFormat: 'shipping',
    printer: settings.shippingPrinter || '',
    paperName: settings.shippingPaperName || '',
    offsetXMm: Number(settings.shippingOffsetXMm) || 0,
    offsetYMm: Number(settings.shippingOffsetYMm) || 0
  };
}

/**
 * Le pilote QL-700 n'accepte que des longueurs discrètes (sur un rouleau 50 mm,
 * une seule : 89,9 mm ; sur un 62 mm : 89,9 / 99,8 / 183,9 mm…).
 * On retient le format le plus court qui contienne réellement la bande : sinon
 * l'étiquette serait rognée, ou on gaspillerait du ruban.
 */
function choosePaper(papers, widthMm, heightMm) {
  const WIDTH_TOL = 3;      // mm
  const HEIGHT_TOL = 0.6;   // arrondis du pilote
  const sameWidth = papers.filter(p => Math.abs(p.widthMm - widthMm) <= WIDTH_TOL);
  if (!sameWidth.length) return null;

  // À longueur égale, un nom du type « 62mm x 100mm » est plus sûr qu'un libellé
  // localisé (accents transmis à PowerShell) et plus lisible dans les réglages.
  const plain = p => (/^\s*\d/.test(p.name) ? 0 : 1);

  const fitting = sameWidth
    .filter(p => p.heightMm >= heightMm - HEIGHT_TOL)
    .sort((a, b) => a.heightMm - b.heightMm || plain(a) - plain(b));
  if (fitting.length) return { ...fitting[0], fits: true };

  const longest = sameWidth.sort((a, b) => b.heightMm - a.heightMm || plain(a) - plain(b))[0];
  return { ...longest, fits: false };
}

/** Format qui sera réellement utilisé pour une bande donnée (écran Réglages). */
async function resolvePaper(printer, widthMm, heightMm) {
  if (!printer) return null;
  return choosePaper(await papersFor(printer), widthMm, heightMm);
}

/**
 * La zone imprimable est plus petite que la page : sur un rouleau 50 mm la QL-700
 * n'imprime que 46,91 mm de large. On réduit donc la bande de façon homothétique
 * pour qu'elle rentre dedans, et on la rend à cette taille exacte — l'impression
 * est alors au 1:1, sans rééchantillonnage qui abîmerait le code-barres.
 */
function fitToPrintable(settings, paper) {
  const nominal = labelSize(settings);
  const pw = paper && Number(paper.printWMm);
  const ph = paper && Number(paper.printHMm);
  if (!(pw > 0) || !(ph > 0)) return { settings, size: nominal, scale: 1 };

  const scale = Math.min(pw / nominal.widthMm, ph / nominal.heightMm);
  if (!(scale > 0) || scale >= 0.999) return { settings, size: nominal, scale: 1 };

  const fitted = scaleSettings(settings, scale);
  return { settings: fitted, size: labelSize(fitted), scale };
}

/**
 * Le rouleau n'a pas de longueur libre : le pilote n'expose que des longueurs figées
 * (une seule, 89,9 mm, sur un rouleau 50 mm). Une bande plus courte que le format —
 * c'est systématique en « 1 seule face » — est alors centrée sur le ruban, d'où une
 * grosse marge blanche en haut ET en bas. Comme le ruban défile de toute façon sur
 * la longueur du format, on étire les faces pour l'occuper entièrement.
 */
function fillPrintable(settings, size, paper) {
  if (size.format !== 'roll' || !Number(settings.rollFillLength)) return { settings, size };
  const ph = paper && Number(paper.printHMm);
  if (!(ph > 0) || size.heightMm >= ph - 0.2) return { settings, size };
  const filled = { ...settings, panelHeightMm: (ph - size.gapMm) / size.panels };
  return { settings: filled, size: labelSize(filled) };
}

/**
 * Tout ce qui découle des réglages pour une impression : format pilote retenu,
 * taille réellement imprimée, réglages ajustés pour le rendu. Utilisé par la file
 * d'impression et par l'écran de réglages, pour qu'ils ne puissent pas diverger.
 */
async function planPrint(settings) {
  const nominal = labelSize(settings);
  if (!settings.printer) return { paper: null, nominal, printed: nominal, scale: 1, settings };

  const papers = await papersFor(settings.printer);
  const paper = settings.paperName
    ? papers.find(p => p.name === settings.paperName) || null
    : choosePaper(papers, nominal.widthMm, nominal.heightMm);

  const fit = fitToPrintable(settings, paper);
  const full = fillPrintable(fit.settings, fit.size, paper);
  return { paper, nominal, printed: full.size, scale: fit.scale, settings: full.settings };
}

/* ------------------------------------------------------------------ */
/* file d'attente                                                      */
/* ------------------------------------------------------------------ */

const now = () => new Date().toISOString();
let onChange = () => {};
let running = false;

function setListener(fn) { onChange = fn; }

function getJob(id) {
  return db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
}

function enqueue(container, requestedBy, format) {
  const s = forFormat(allSettings(), format);
  const info = db.prepare(
    `INSERT INTO print_jobs (container_id, code, status, printer, format, requested_by, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, ?, ?, ?)`
  ).run(container.id, container.code, s.printer || '', s.labelFormat, requestedBy || '', now(), now());
  const id = Number(info.lastInsertRowid);
  onChange({ type: 'print', job: getJob(id) });
  setImmediate(pump);
  return getJob(id);
}

/**
 * Le « kit » d'un carton : la grande étiquette 4x6 pour la face qu'on lit de loin,
 * puis N bandes rouleau pour les autres côtés — un carton empilé ne montre jamais
 * la même face, et on ne veut pas avoir à le tourner pour savoir ce qu'il y a dedans.
 *
 * Un job par étiquette, et la grande en premier : si le ruban se bloque au milieu,
 * on ne réimprime que celle qui manque au lieu de tout relancer.
 */
function enqueueKit(container, requestedBy) {
  const copies = Math.max(0, Math.min(6, Number(allSettings().kitSmallCopies) || 0));
  const jobs = [enqueue(container, requestedBy, 'shipping')];
  for (let i = 0; i < copies; i++) jobs.push(enqueue(container, requestedBy, 'roll'));
  return jobs;
}

function update(id, fields) {
  const keys = Object.keys(fields);
  db.prepare(
    `UPDATE print_jobs SET ${keys.map(k => k + ' = ?').join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...keys.map(k => fields[k]), now(), id);
  onChange({ type: 'print', job: getJob(id) });
}

function buildBoxForLabel(containerId) {
  const box = db.prepare('SELECT * FROM containers WHERE id = ?').get(containerId);
  if (!box) return null;
  const items = db.prepare(
    'SELECT label FROM items WHERE container_id = ? ORDER BY position, id LIMIT 8'
  ).all(containerId).map(r => r.label);
  return {
    code: box.code,
    owner: box.owner,
    kind: box.kind,
    title: box.title,
    subtitle: items.join(', '),
    items,                                  // liste détaillée : la 4x6 a la place
    destination: box.destination,
    tags: JSON.parse(box.tags || '[]')
  };
}

async function pump() {
  if (running) return;
  const job = db.prepare("SELECT * FROM print_jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get();
  if (!job) return;
  running = true;
  try {
    update(job.id, { status: 'printing', error: '' });
    // Le job garde le format demandé : changer le réglage par défaut entre-temps
    // ne doit pas rerouter une étiquette déjà en file vers l'autre imprimante.
    const s = forFormat(allSettings(), job.format);
    const box = buildBoxForLabel(job.container_id);
    if (!box) throw new Error('Carton introuvable');

    if (!s.printer) {
      // Mode aperçu : pas d'imprimante configurée, on garde juste l'image.
      const rendered = await renderLabelToFile(box, s);
      update(job.id, { image: path.basename(rendered.file) });
      update(job.id, { status: 'done', printer: 'Aperçu (aucune imprimante)' });
      return;
    }

    /* Le format du pilote se choisit AVANT le rendu : c'est lui qui dicte la
       zone imprimable, donc la taille à laquelle dessiner l'étiquette. */
    const plan = await planPrint(s);
    if (plan.paper && plan.paper.fits === false) {
      throw new Error(
        `Étiquette de ${plan.nominal.heightMm.toFixed(0)} mm trop longue : le plus grand format ` +
        `${plan.nominal.widthMm.toFixed(0)} mm du pilote fait ${plan.paper.heightMm} mm. ` +
        (s.labelFormat === 'shipping'
          ? 'Vérifie la taille de l’étiquette 4x6 dans les réglages.'
          : 'Réduis la hauteur de face ou la zone de pli dans les réglages.')
      );
    }
    const paper = plan.paper;
    const rendered = await renderLabelToFile(box, plan.settings);
    update(job.id, { image: path.basename(rendered.file) });

    const args = [
      '-Image', rendered.file,
      '-Printer', s.printer,
      '-WidthMm', String(rendered.widthMm.toFixed(2)),
      '-HeightMm', String(rendered.heightMm.toFixed(2)),
      '-OffsetXMm', String(Number(s.offsetXMm) || 0),
      '-OffsetYMm', String(Number(s.offsetYMm) || 0)
    ];
    if (paper) args.push('-PaperName', paper.name);
    await runPs(args);
    update(job.id, { status: 'done', printer: s.printer });
  } catch (e) {
    update(job.id, { status: 'error', error: String(e.message || e).slice(0, 500) });
  } finally {
    running = false;
    setImmediate(pump);
  }
}

function retry(id) {
  const job = getJob(id);
  if (!job) return null;
  update(id, { status: 'queued', error: '' });
  setImmediate(pump);
  return getJob(id);
}

function cancel(id) {
  const job = getJob(id);
  if (!job || job.status === 'printing') return null;
  db.prepare('DELETE FROM print_jobs WHERE id = ?').run(id);
  onChange({ type: 'print', removed: id });
  return true;
}

function listJobs(limit = 40) {
  return db.prepare('SELECT * FROM print_jobs ORDER BY id DESC LIMIT ?').all(limit);
}

/** Au démarrage : les jobs restés « printing » après un crash repassent en attente. */
function recover() {
  db.prepare("UPDATE print_jobs SET status = 'queued' WHERE status = 'printing'").run();
  setImmediate(pump);
}

module.exports = {
  enqueue, enqueueKit, retry, cancel, listJobs, listPrinters, listPapers,
  resolvePaper, planPrint, forFormat, setListener, recover, pump
};
