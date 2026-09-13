'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA_DIR, 'photos'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'labels'), { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'demenagement.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS containers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  code         TEXT    NOT NULL UNIQUE,
  seq          INTEGER NOT NULL,
  owner        TEXT    NOT NULL,                    -- L | S | M
  kind         TEXT    NOT NULL DEFAULT 'box',      -- box | item
  title        TEXT    NOT NULL DEFAULT '',
  notes        TEXT    NOT NULL DEFAULT '',
  destination  TEXT    NOT NULL DEFAULT '',
  origin       TEXT    NOT NULL DEFAULT '',
  tags         TEXT    NOT NULL DEFAULT '[]',
  status       TEXT    NOT NULL DEFAULT 'open',     -- open|closed|loaded|arrived|unpacked
  created_by   TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL,
  closed_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_containers_status ON containers(status);
CREATE INDEX IF NOT EXISTS idx_containers_owner  ON containers(owner);

CREATE TABLE IF NOT EXISTS items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  label        TEXT    NOT NULL,
  qty          INTEGER NOT NULL DEFAULT 1,
  position     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_items_container ON items(container_id);

CREATE TABLE IF NOT EXISTS photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  file         TEXT    NOT NULL,
  thumb        TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_photos_container ON photos(container_id);

CREATE TABLE IF NOT EXISTS print_jobs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  container_id INTEGER NOT NULL REFERENCES containers(id) ON DELETE CASCADE,
  code         TEXT    NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'queued',   -- queued|printing|done|error
  printer      TEXT    NOT NULL DEFAULT '',
  image        TEXT    NOT NULL DEFAULT '',
  error        TEXT    NOT NULL DEFAULT '',
  requested_by TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL,
  updated_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON print_jobs(status);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`);

/* Colonne ajoutee apres coup : une base creee avant le format 4x6 n'a pas "format". */
{
  const cols = db.prepare('PRAGMA table_info(print_jobs)').all().map(c => c.name);
  if (!cols.includes('format')) {
    db.exec("ALTER TABLE print_jobs ADD COLUMN format TEXT NOT NULL DEFAULT 'roll'");
  }
}

/* ---------- settings ---------- */

const DEFAULT_SETTINGS = {
  labelFormat: 'roll',               // format utilise par defaut : roll | shipping

  /* --- profil « rouleau 50 mm » (Brother QL-700) --- */
  printer: '',                       // '' => mode aperçu (aucune impression)
  labelWidthMm: 50,                  // rouleau continu 50 mm (DK-22223, 30 m)
  panelHeightMm: 38,                 // hauteur d'une face
  foldGapMm: 12,                     // zone blanche laissee sur l'arete du carton
  offsetXMm: 0,                      // recalage fin de l'impression (+ = droite)
  offsetYMm: 0,                      // recalage fin de l'impression (+ = bas)
  paperName: '',                     // format pilote force ('' = detection auto par largeur)
  labelMode: 'fold',                 // fold | mirror | single
  rollFillLength: 1,                 // etirer les faces sur toute la longueur du format pilote

  /* --- profil « etiquette 4x6 » (imprimante d'expedition) ---
     Ici la hauteur ne se deduit pas des faces : l'etiquette est predecoupee, sa
     taille est imposee. Ce sont les faces qui se partagent la hauteur disponible. */
  shippingPrinter: '',
  shippingPaperName: '',
  shippingWidthMm: 101.6,            // 4 pouces
  shippingHeightMm: 152.4,           // 6 pouces
  shippingMode: 'single',            // single | fold | cut
  shippingFoldGapMm: 12,             // zone blanche au pli, prise SUR l'etiquette
  shippingOffsetXMm: 0,
  shippingOffsetYMm: 0,

  dpi: 300,
  autoPrintOnClose: 1,

  /* --- le « kit » d'un carton ---
     Fermer un carton n'imprime pas une etiquette mais un jeu complet : la grande
     4x6 qu'on lit de loin sur une face, plus N bandes rouleau pour les autres
     cotes du carton (un carton empile ne montre jamais la meme face). */
  kitOnClose: 1,
  kitSmallCopies: 3,                 // bandes rouleau, en plus de la grande (0 a 6)

  destinations: JSON.stringify([
    'Cuisine', 'Salon', 'Chambre', 'Bureau', 'Salle de bain',
    'Entrée', 'Cave', 'Garage', 'Grenier', 'Garde-meuble', 'À trier'
  ]),
  /* Raccourcis de contenu : ce qu'on range depend de a qui c'est.
     Lucas / Solene => affaires personnelles ; Mixte => ce qui est au foyer. */
  quickTitlesPerso: JSON.stringify([
    'Habits', 'Chaussures', 'Manteaux', 'Affaires de sport', 'Sacs & accessoires',
    'Bijoux', 'Affaires de toilette', 'Cosmétiques', 'Livres', 'Papiers personnels',
    'Souvenirs', 'Photos & cadres', 'Ordinateur', 'Câbles & chargeurs', 'Jeux vidéo',
    'Loisirs créatifs', 'Bureau', 'Valises', 'Divers perso'
  ]),
  quickTitlesMixte: JSON.stringify([
    'Vaisselle', 'Verres', 'Casseroles & poêles', 'Ustensiles de cuisine',
    'Petit électroménager', 'Épicerie', 'Produits ménagers', 'Linge de maison',
    'Draps & couettes', 'Serviettes', 'Déco', 'Luminaires', 'Livres',
    'Jeux de société', 'Outils & bricolage', 'Jardin', 'Papiers administratifs',
    'Câbles & multiprises', 'Salle de bain', 'Divers'
  ])
};

/* Ancienne liste unique (avant la separation perso / mixte) : on la recopie dans les
   deux nouvelles listes puis on la retire, pour ne pas effacer une personnalisation. */
{
  const legacy = db.prepare('SELECT value FROM settings WHERE key = ?').get('quickTitles');
  if (legacy) {
    const has = k => db.prepare('SELECT 1 FROM settings WHERE key = ?').get(k);
    const ins = db.prepare('INSERT INTO settings(key, value) VALUES(?, ?)');
    if (!has('quickTitlesPerso')) ins.run('quickTitlesPerso', legacy.value);
    if (!has('quickTitlesMixte')) ins.run('quickTitlesMixte', legacy.value);
    db.prepare('DELETE FROM settings WHERE key = ?').run('quickTitles');
  }
}

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function getSetting(key) {
  const row = getSettingStmt.get(key);
  return row ? row.value : DEFAULT_SETTINGS[key];
}
function setSetting(key, value) {
  setSettingStmt.run(String(key), String(value));
}
function allSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  out.destinations = JSON.parse(out.destinations);
  out.quickTitlesPerso = JSON.parse(out.quickTitlesPerso);
  out.quickTitlesMixte = JSON.parse(out.quickTitlesMixte);
  for (const k of [
    'labelWidthMm', 'panelHeightMm', 'foldGapMm', 'offsetXMm', 'offsetYMm',
    'shippingWidthMm', 'shippingHeightMm', 'shippingFoldGapMm',
    'shippingOffsetXMm', 'shippingOffsetYMm'
  ]) out[k] = Number(out[k]);
  out.dpi = Number(out.dpi);
  out.kitSmallCopies = Number(out.kitSmallCopies);
  out.autoPrintOnClose = Number(out.autoPrintOnClose) ? 1 : 0;
  out.kitOnClose = Number(out.kitOnClose) ? 1 : 0;
  out.rollFillLength = Number(out.rollFillLength) ? 1 : 0;
  return out;
}

module.exports = { db, getSetting, setSetting, allSettings, DATA_DIR, DEFAULT_SETTINGS };
