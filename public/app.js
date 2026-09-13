/* eslint-disable */
'use strict';

/* ================================================================== */
/* État + utilitaires                                                  */
/* ================================================================== */

const S = {
  user: localStorage.getItem('user') || '',
  meta: null,
  boxes: [],
  jobs: [],
  stats: null,
  filters: { q: '', owner: '', destination: '', status: '', kind: '', tag: '' }
};

const $ = sel => document.querySelector(sel);
const view = () => $('#view');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Les raccourcis de contenu et de destination vivent a l'interieur du <label>
   de leur champ texte : un clic dessus active le label, ce qui focalise l'input
   et fait surgir le clavier mobile par-dessus toute l'UI. On neutralise cette
   activation (mousedown pour le focus, click pour l'activation du label) sans
   toucher au focus deja en place : si la saisie manuelle est en cours, le
   clavier reste ouvert et le curseur ne bouge pas. */
function chipsKeepFocus(el) {
  if (!el) return;
  const stop = e => { if (e.target.closest('.chip')) e.preventDefault(); };
  el.addEventListener('mousedown', stop);
  el.addEventListener('click', stop);
}

async function api(url, opts = {}) {
  const o = Object.assign({ headers: {} }, opts);
  o.headers['X-User'] = S.user;
  if (o.body && !(o.body instanceof FormData)) {
    o.headers['Content-Type'] = 'application/json';
    o.body = JSON.stringify(o.body);
  }
  const r = await fetch(url, o);
  if (!r.ok) {
    let msg = 'Erreur ' + r.status;
    try { msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return r.status === 204 ? null : r.json();
}

/* Un champ numérique focalisé change de valeur au moindre défilement de la molette
   ou du pavé tactile — et ici cela reconfigure silencieusement l'imprimante. */
document.addEventListener('wheel', e => {
  const el = document.activeElement;
  if (el && el.type === 'number' && el === e.target) el.blur();
}, { passive: true });

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

const OWNER_INITIAL = { L: 'L', S: 'S', M: 'M' };
const ownerName = o => (S.meta && S.meta.owners[o] ? S.meta.owners[o].name : o);
const statusLabel = s => ((S.meta && S.meta.statuses.find(x => x.id === s)) || {}).label || s;
const tagDef = id => (S.meta && S.meta.tags.find(t => t.id === id)) || { label: id, emoji: '' };

function ownerBadge(o) {
  return `<span class="badge-owner o-${esc(o)}"><span class="av"><b>${OWNER_INITIAL[o] || '?'}</b></span>${esc(ownerName(o))}</span>`;
}

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  scan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M7 12h10"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 15h12v6H6z"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a1.7 1.7 0 0 0-1.6-1H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 3.6V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 3a1.7 1.7 0 0 0 1.9.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1z" transform="translate(1.1 1.1) scale(.92)"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>'
};

/* ================================================================== */
/* Démarrage                                                           */
/* ================================================================== */

async function boot() {
  S.meta = await api('/api/meta');
  if (S.user) enter(); else showGate();
  window.addEventListener('hashchange', route);
  connectEvents();
}

function showGate() {
  const owners = ['L', 'S'];
  $('#whoBtns').innerHTML = owners.map(o => {
    const n = S.meta.owners[o].name;
    return `<button data-who="${o}"><span class="av" style="background:var(--${o})">${OWNER_INITIAL[o]}</span>${esc(n)}</button>`;
  }).join('');
  $('#whoBtns').onclick = e => {
    const b = e.target.closest('[data-who]');
    if (!b) return;
    S.user = S.meta.owners[b.dataset.who].name;
    localStorage.setItem('user', S.user);
    localStorage.setItem('userCode', b.dataset.who);
    /* Un brouillon ouvert a été créé au nom du profil précédent : il suit le nouveau,
       sauf si le propriétaire avait été choisi à la main — ce choix-là est délibéré. */
    if (draft && !draft.ownerPinned) draft.owner = b.dataset.who;
    enter();
  };
  $('#gate').style.display = 'grid';
}

function myCode() {
  return localStorage.getItem('userCode') || 'L';
}

function enter() {
  $('#gate').style.display = 'none';
  $('#app').classList.add('ready');
  renderNav();
  $('#userChip').innerHTML =
    `<span class="av" style="background:var(--${myCode()})">${OWNER_INITIAL[myCode()]}</span>${esc(S.user)}`;
  $('#userChip').onclick = () => {
    localStorage.removeItem('user'); localStorage.removeItem('userCode');
    S.user = ''; $('#app').classList.remove('ready'); showGate();
  };
  if (!location.hash) location.hash = '#/';
  route();
}

const NAV = [
  { href: '#/', icon: 'home', label: 'Accueil' },
  { href: '#/new', icon: 'plus', label: 'Nouveau' },
  { href: '#/scan', icon: 'scan', label: 'Scanner' },
  { href: '#/list', icon: 'box', label: 'Cartons' },
  { href: '#/print', icon: 'print', label: 'Étiquettes', badge: true },
  { href: '#/settings', icon: 'gear', label: 'Réglages', desktopOnly: true }
];

function renderNav() {
  const cur = location.hash || '#/';
  $('#nav').innerHTML = NAV.map(n => {
    const active = cur === n.href || (n.href !== '#/' && cur.startsWith(n.href)) ? 'active' : '';
    const pending = n.badge && S.stats && S.stats.queued ? `<span class="badge">${S.stats.queued}</span>` : '';
    return `<a href="${n.href}" class="${active} ${n.desktopOnly ? 'desktop-only' : ''}">${ICONS[n.icon]}<span>${n.label}</span>${pending}</a>`;
  }).join('');
}

/* ================================================================== */
/* Temps réel                                                          */
/* ================================================================== */

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onopen = () => $('#live').classList.add('on');
  es.onerror = () => $('#live').classList.remove('on');
  es.onmessage = ev => {
    let d; try { d = JSON.parse(ev.data); } catch { return; }
    if (d.type === 'settings') S.meta.settings = d.settings;
    const r = location.hash;
    if (d.type === 'print') {
      if (r.startsWith('#/print')) renderPrint();
      if (d.job && d.job.status === 'error') toast(`Étiquette ${d.job.code} : ${d.job.error}`, 'err');
      if (d.job && d.job.status === 'done') toast(`Étiquette ${d.job.code} imprimée`, 'ok');
      refreshStats();
    }
    if (d.type === 'container') {
      if (r === '#/' ) renderHome();
      else if (r.startsWith('#/list')) renderList();
      else if (d.container && r === '#/box/' + d.container.code) renderBox(d.container.code);
      refreshStats();
    }
  };
}

async function refreshStats() {
  try { S.stats = await api('/api/stats'); renderNav(); } catch {}
}

/* ================================================================== */
/* Routeur                                                             */
/* ================================================================== */

function route() {
  renderNav();
  const h = location.hash || '#/';
  window.scrollTo(0, 0);
  stopCamera();
  if (h === '#/') return renderHome();
  if (h === '#/new') return renderNew();
  if (h === '#/scan') return renderScan();
  if (h.startsWith('#/list')) return renderList();
  if (h === '#/print') return renderPrint();
  if (h === '#/settings') return renderSettings();
  if (h.startsWith('#/box/')) return renderBox(decodeURIComponent(h.slice(6)));
  view().innerHTML = '<div class="empty">Page inconnue</div>';
}

/* ================================================================== */
/* Accueil                                                             */
/* ================================================================== */

async function renderHome() {
  const [stats, recent] = await Promise.all([api('/api/stats'), api('/api/containers')]);
  S.stats = stats; renderNav();
  const open = recent.filter(b => b.status === 'open');
  const byStatus = Object.fromEntries(stats.byStatus.map(r => [r.status, r.c]));

  view().innerHTML = `
    <h2 class="title">Bonjour ${esc(S.user)} 👋</h2>
    <p class="sub">${stats.total} référence${stats.total > 1 ? 's' : ''} enregistrée${stats.total > 1 ? 's' : ''}${stats.photos ? ` · ${stats.photos} photo${stats.photos > 1 ? 's' : ''}` : ''}</p>

    <div class="row" style="margin-bottom:16px">
      <a href="#/new" class="btn primary big" style="flex:2;min-width:190px">${ICONS.plus} Nouveau carton</a>
      <a href="#/scan" class="btn big" style="flex:1;min-width:140px">${ICONS.scan} Scanner</a>
    </div>

    <div class="tiles" style="margin-bottom:20px">
      <div class="tile"><b>${byStatus.open || 0}</b><span>en cours</span></div>
      <div class="tile"><b>${byStatus.closed || 0}</b><span>fermés</span></div>
      <div class="tile"><b>${byStatus.arrived || 0}</b><span>arrivés</span></div>
      <div class="tile"><b>${byStatus.unpacked || 0}</b><span>déballés</span></div>
      ${stats.queued ? `<a href="#/print" class="tile" style="text-decoration:none;color:inherit"><b style="color:var(--accent)">${stats.queued}</b><span>en impression</span></a>` : ''}
      ${stats.failed ? `<a href="#/print" class="tile" style="text-decoration:none;color:inherit"><b style="color:var(--danger)">${stats.failed}</b><span>échec impression</span></a>` : ''}
    </div>

    ${open.length ? `
      <h3 style="font-size:16px;margin:0 0 10px">Cartons en cours de remplissage</h3>
      <div class="grid" style="margin-bottom:22px">${open.slice(0, 6).map(boxCard).join('')}</div>` : ''}

    ${stats.byDestination.length ? `
      <h3 style="font-size:16px;margin:0 0 10px">Par destination</h3>
      <div class="chips" style="margin-bottom:22px">
        ${stats.byDestination.map(d => `<a class="chip sm" style="text-decoration:none" href="#/list?destination=${encodeURIComponent(d.destination)}">${esc(d.destination)} · <b>${d.c}</b></a>`).join('')}
      </div>` : ''}

    <h3 style="font-size:16px;margin:0 0 10px">Derniers ajouts</h3>
    <div class="grid">${recent.slice(0, 8).map(boxCard).join('') || '<div class="empty">Rien pour l’instant.</div>'}</div>

    <a href="#/settings" class="btn ghost mobile-only" style="margin-top:24px;width:100%">${ICONS.gear} Réglages</a>
  `;
}

function boxCard(b) {
  const tags = (b.tags || []).slice(0, 2).map(t => `<span class="pill ${t === 'fragile' ? 'frag' : 'tag'}">${tagDef(t).emoji} ${esc(tagDef(t).short || tagDef(t).label)}</span>`).join(' ');
  return `<a class="bx" href="#/box/${encodeURIComponent(b.code)}">
    <div class="thumb">${b.cover
      ? `<img loading="lazy" src="/photos/${esc(b.cover)}" alt="">`
      : `<span class="ph">${ICONS.box}</span>`}</div>
    <div class="body">
      <div class="code">${esc(b.code)} ${b.kind === 'item' ? '<span class="muted small">objet</span>' : ''}</div>
      <div class="ttl">${esc(b.title || '(sans description)')}</div>
      <div class="meta">
        ${ownerBadge(b.owner)}
        ${b.destination ? `<span>→ ${esc(b.destination)}</span>` : ''}
        <span class="pill ${esc(b.status)}">${esc(statusLabel(b.status))}</span>
        ${tags}
      </div>
    </div>
  </a>`;
}

/* ================================================================== */
/* Création rapide                                                     */
/* ================================================================== */

let draft = null;

function newDraft() {
  return {
    // ownerPinned : le proprietaire suit le profil actif tant qu'on n'y a pas touche.
    kind: 'box', owner: myCode(), ownerPinned: false, title: '', destination: '', tags: [],
    items: [], notes: '', photos: []
  };
}

/* Mixte = ce qui appartient au foyer (vaisselle, produits menagers) ; Lucas et
   Solene = leurs affaires a eux. Les raccourcis proposes suivent ce choix. */
function quickTitlesFor(owner) {
  const st = S.meta.settings;
  return owner === 'M' ? st.quickTitlesMixte : st.quickTitlesPerso;
}

function quickTitleChips(owner) {
  return quickTitlesFor(owner)
    .map(t => `<span class="chip sm" data-t="${esc(t)}">${esc(t)}</span>`).join('');
}

/**
 * Ce qui partira à l'impression quand on ferme un carton : la grande étiquette pour
 * la face avant, plus les bandes du rouleau pour les autres côtés. Le même calcul
 * sert au texte du bouton, à la ligne d'avertissement dessous et au message de fin —
 * on doit savoir ce qui va sortir avant de cliquer, pas après.
 */
function closePlan() {
  const st = S.meta.settings;
  const printerOf = fmt => (fmt === 'shipping' ? st.shippingPrinter : st.printer);
  const kit = Boolean(st.kitOnClose);
  const small = kit ? Math.max(0, Math.min(6, Number(st.kitSmallCopies) || 0)) : 0;
  const parts = (kit
    ? [{ format: 'shipping', n: 1 }, { format: 'roll', n: small }]
    : [{ format: st.labelFormat, n: 1 }]
  ).filter(p => p.n > 0).map(p => ({ ...p, printer: printerOf(p.format) }));
  return {
    auto: Boolean(st.autoPrintOnClose), kit, small, parts,
    total: parts.reduce((n, p) => n + p.n, 0)
  };
}

/** « 1 × 4×6 + 3 × 50 mm » : le contenu du kit en une ligne. */
const planText = plan => plan.parts.map(p => `${p.n} × ${formatShort(p.format)}`).join(' + ');

function renderNew() {
  if (!draft) draft = newDraft();
  const st = S.meta.settings;
  const plan = closePlan();

  view().innerHTML = `
    <h2 class="title">Nouveau</h2>
    <p class="sub">Le code est attribué automatiquement à l’enregistrement.</p>

    <div class="stack">
      <div class="seg" id="kindSeg">
        <button data-k="box" class="${draft.kind === 'box' ? 'on' : ''}">📦 Carton</button>
        <button data-k="item" class="${draft.kind === 'item' ? 'on' : ''}">🪑 Objet / meuble</button>
      </div>

      <label class="field">
        <span>À qui ça appartient</span>
        <div class="owners" id="ownerSel">
          ${['L', 'S', 'M'].map(o => `<button data-o="${o}" class="${draft.owner === o ? 'on' : ''}">
            <span class="av" style="background:var(--${o})">${OWNER_INITIAL[o]}</span>${esc(S.meta.owners[o].name)}</button>`).join('')}
        </div>
      </label>

      <label class="field">
        <span>Contenu (visible sur l’étiquette)</span>
        <input type="text" id="fTitle" placeholder="Ex : Habits d’hiver, chaussures" value="${esc(draft.title)}" autocomplete="off">
        <div class="chips" id="quickTitles">${quickTitleChips(draft.owner)}</div>
      </label>

      <label class="field">
        <span>Destination</span>
        <div class="chips" id="destChips">
          ${st.destinations.map(d => `<span class="chip" data-d="${esc(d)}">${esc(d)}</span>`).join('')}
        </div>
        <input type="text" id="fDest" placeholder="ou saisir une autre destination" value="${esc(draft.destination)}" autocomplete="off">
      </label>

      <label class="field">
        <span>Sigles à imprimer</span>
        <div class="chips" id="tagChips">
          ${S.meta.tags.map(t => `<span class="chip" data-tag="${t.id}">${t.emoji} ${esc(t.label)}</span>`).join('')}
        </div>
      </label>

      <label class="field">
        <span>Photos du contenu</span>
        <div class="photos" id="photoGrid"></div>
        <div class="row">
          <button class="btn" id="btnCam" style="flex:1">${ICONS.cam} Prendre une photo</button>
          <button class="btn" id="btnFile" style="flex:1">🖼️ Galerie</button>
        </div>
        <input type="file" id="capInput" accept="image/*" capture="environment" multiple hidden>
        <input type="file" id="fileInput" accept="image/*" multiple hidden>
      </label>

      <details>
        <summary style="cursor:pointer;font-weight:600;color:var(--muted);padding:6px 0">Détail du contenu et notes (optionnel)</summary>
        <div class="stack" style="margin-top:12px">
          <label class="field">
            <span>Lister les objets un par un</span>
            <input type="text" id="fItem" placeholder="Taper puis Entrée…" autocomplete="off">
            <ul class="items" id="itemList"></ul>
          </label>
          <label class="field">
            <span>Notes</span>
            <textarea id="fNotes" placeholder="Précisions, numéro d’étagère…">${esc(draft.notes)}</textarea>
          </label>
        </div>
      </details>

      <hr class="hr">

      <button class="btn primary big" id="btnClose">
        ${ICONS.print} ${plan.auto
          ? (plan.kit
            ? `Fermer le carton et imprimer le kit (${planText(plan)})`
            : 'Fermer le carton et imprimer l’étiquette')
          : 'Fermer le carton'}
      </button>
      <button class="btn big" id="btnSaveOpen">Enregistrer et continuer à remplir</button>
      <p class="small muted" style="text-align:center;margin:0">
        ${!plan.auto
          ? 'Impression automatique désactivée — rien ne partira à la fermeture.'
          : plan.parts.map(p => p.printer
            ? `${esc(formatShort(p.format))} : ${esc(p.printer)}`
            : `⚠️ ${esc(formatShort(p.format))} : aucune imprimante — l’étiquette sera seulement générée en aperçu.`
          ).join('<br>')}
      </p>
    </div>
  `;

  syncDraftUI();

  $('#kindSeg').onclick = e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    draft.kind = b.dataset.k;
    [...$('#kindSeg').children].forEach(c => c.classList.toggle('on', c === b));
  };
  $('#ownerSel').onclick = e => {
    const b = e.target.closest('[data-o]'); if (!b) return;
    const before = draft.owner;
    draft.owner = b.dataset.o;
    draft.ownerPinned = true;
    [...$('#ownerSel').children].forEach(c => c.classList.toggle('on', c === b));
    // Passer de perso a mixte (ou l'inverse) change les raccourcis proposes.
    if ((before === 'M') !== (draft.owner === 'M')) {
      $('#quickTitles').innerHTML = quickTitleChips(draft.owner);
      syncDraftUI();
    }
  };
  $('#fTitle').oninput = e => { draft.title = e.target.value; };
  chipsKeepFocus($('#quickTitles'));
  $('#quickTitles').onclick = e => {
    const c = e.target.closest('[data-t]'); if (!c) return;
    const cur = $('#fTitle').value.trim();
    const parts = cur ? cur.split(',').map(s => s.trim()).filter(Boolean) : [];
    const t = c.dataset.t;
    const i = parts.indexOf(t);
    if (i >= 0) parts.splice(i, 1); else parts.push(t);
    draft.title = parts.join(', ');
    $('#fTitle').value = draft.title;
    syncDraftUI();
  };
  chipsKeepFocus($('#destChips'));
  $('#destChips').onclick = e => {
    const c = e.target.closest('[data-d]'); if (!c) return;
    draft.destination = draft.destination === c.dataset.d ? '' : c.dataset.d;
    $('#fDest').value = draft.destination;
    syncDraftUI();
  };
  $('#fDest').oninput = e => { draft.destination = e.target.value; syncDraftUI(); };
  $('#tagChips').onclick = e => {
    const c = e.target.closest('[data-tag]'); if (!c) return;
    const id = c.dataset.tag;
    const i = draft.tags.indexOf(id);
    if (i >= 0) draft.tags.splice(i, 1); else draft.tags.push(id);
    syncDraftUI();
  };
  $('#fNotes').oninput = e => { draft.notes = e.target.value; };
  $('#fItem').onkeydown = e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim();
    if (!v) return;
    draft.items.push(v); e.target.value = ''; syncDraftUI();
  };
  $('#itemList').onclick = e => {
    const b = e.target.closest('[data-rm]'); if (!b) return;
    draft.items.splice(Number(b.dataset.rm), 1); syncDraftUI();
  };

  $('#btnCam').onclick = e => { e.preventDefault(); $('#capInput').click(); };
  $('#btnFile').onclick = e => { e.preventDefault(); $('#fileInput').click(); };
  const onPick = async e => {
    for (const f of e.target.files) draft.photos.push(await shrink(f));
    e.target.value = '';
    syncDraftUI();
  };
  $('#capInput').onchange = onPick;
  $('#fileInput').onchange = onPick;
  $('#photoGrid').onclick = e => {
    const b = e.target.closest('[data-rmp]'); if (!b) return;
    draft.photos.splice(Number(b.dataset.rmp), 1); syncDraftUI();
  };

  $('#btnClose').onclick = () => submitDraft(true);
  $('#btnSaveOpen').onclick = () => submitDraft(false);
}

function syncDraftUI() {
  document.querySelectorAll('#tagChips [data-tag]').forEach(c =>
    c.classList.toggle('on', draft.tags.includes(c.dataset.tag)));
  document.querySelectorAll('#destChips [data-d]').forEach(c =>
    c.classList.toggle('on', draft.destination === c.dataset.d));
  const titleParts = draft.title.split(',').map(s => s.trim());
  document.querySelectorAll('#quickTitles [data-t]').forEach(c =>
    c.classList.toggle('on', titleParts.includes(c.dataset.t)));

  const list = $('#itemList');
  if (list) list.innerHTML = draft.items.map((it, i) =>
    `<li><span>${esc(it)}</span><button data-rm="${i}" title="Retirer">✕</button></li>`).join('');

  const grid = $('#photoGrid');
  if (grid) grid.innerHTML = draft.photos.map((p, i) =>
    `<div class="p"><img src="${URL.createObjectURL(p)}" alt=""><button data-rmp="${i}">✕</button></div>`).join('');
}

/** Réduit la photo côté client : upload rapide même en Wi-Fi faible. */
async function shrink(file, maxSide = 1600, quality = 0.82) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 900e3) { bmp.close(); return file; }
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', quality));
    return blob ? new File([blob], (file.name || 'photo') + '.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}

async function submitDraft(close) {
  const btn = close ? $('#btnClose') : $('#btnSaveOpen');
  if (!draft.title.trim() && !draft.items.length) {
    toast('Indique au moins ce qu’il y a dedans', 'err');
    $('#fTitle').focus();
    return;
  }
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.textContent = 'Enregistrement…';
  try {
    const created = await api('/api/containers', {
      method: 'POST',
      body: {
        kind: draft.kind, owner: draft.owner, title: draft.title.trim(),
        destination: draft.destination.trim(), tags: draft.tags,
        notes: draft.notes.trim(), items: draft.items
      }
    });

    if (draft.photos.length) {
      btn.textContent = 'Envoi des photos…';
      const fd = new FormData();
      draft.photos.forEach(p => fd.append('photos', p, p.name || 'photo.jpg'));
      await fetch(`/api/containers/${created.id}/photos`, { method: 'POST', headers: { 'X-User': S.user }, body: fd });
    }

    if (close) {
      btn.textContent = 'Impression…';
      const r = await api(`/api/containers/${created.id}/close`, { method: 'POST', body: {} });
      const jobs = r.jobs || (r.job ? [r.job] : []);
      const counts = {};
      for (const j of jobs) counts[j.format || 'roll'] = (counts[j.format || 'roll'] || 0) + 1;
      const detail = Object.entries(counts).map(([fmt, n]) => `${n} × ${formatShort(fmt)}`).join(' + ');
      toast(jobs.length
        ? `${created.code} fermé — ${detail} envoyé${jobs.length > 1 ? 's' : ''} à l’impression`
        : `${created.code} fermé`, 'ok');
    } else {
      toast(`${created.code} créé`, 'ok');
    }
    draft = newDraft();
    location.hash = '#/box/' + encodeURIComponent(created.code);
  } catch (e) {
    toast(e.message, 'err');
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

/* ================================================================== */
/* Liste + recherche                                                   */
/* ================================================================== */

function parseListQuery() {
  const qs = new URLSearchParams((location.hash.split('?')[1] || ''));
  for (const k of Object.keys(S.filters)) S.filters[k] = qs.get(k) || '';
}

async function renderList() {
  parseListQuery();
  const f = S.filters;
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  const boxes = await api('/api/containers?' + qs);
  S.boxes = boxes;
  const st = S.meta.settings;

  view().innerHTML = `
    <h2 class="title">Cartons & objets</h2>
    <p class="sub">${boxes.length} résultat${boxes.length > 1 ? 's' : ''}</p>

    <div class="stack" style="margin-bottom:16px">
      <input type="search" id="q" placeholder="Rechercher : code, contenu, objet, pièce…" value="${esc(f.q)}">
      <div class="chips">
        <span class="chip sm ${!f.owner ? 'on' : ''}" data-fk="owner" data-fv="">Tous</span>
        ${['L', 'S', 'M'].map(o => `<span class="chip sm ${f.owner === o ? 'on' : ''}" data-fk="owner" data-fv="${o}">${esc(S.meta.owners[o].name)}</span>`).join('')}
      </div>
      <div class="chips">
        <span class="chip sm ${!f.status ? 'on' : ''}" data-fk="status" data-fv="">Tous statuts</span>
        ${S.meta.statuses.map(s => `<span class="chip sm ${f.status === s.id ? 'on' : ''}" data-fk="status" data-fv="${s.id}">${esc(s.label)}</span>`).join('')}
      </div>
      <div class="chips">
        <span class="chip sm ${!f.destination ? 'on' : ''}" data-fk="destination" data-fv="">Toutes destinations</span>
        ${st.destinations.map(d => `<span class="chip sm ${f.destination === d ? 'on' : ''}" data-fk="destination" data-fv="${esc(d)}">${esc(d)}</span>`).join('')}
      </div>
      <div class="chips">
        ${S.meta.tags.map(t => `<span class="chip sm ${f.tag === t.id ? 'on' : ''}" data-fk="tag" data-fv="${t.id}">${t.emoji} ${esc(t.label)}</span>`).join('')}
        <span class="chip sm ${f.kind === 'item' ? 'on' : ''}" data-fk="kind" data-fv="item">🪑 Objets seuls</span>
      </div>
    </div>

    <div class="grid">${boxes.map(boxCard).join('') ||
      `<div class="empty">${ICONS.box}<div>Aucun résultat.</div></div>`}</div>
  `;

  let t;
  $('#q').oninput = e => {
    clearTimeout(t);
    t = setTimeout(() => { setFilter('q', e.target.value); }, 250);
  };
  view().onclick = e => {
    const c = e.target.closest('[data-fk]'); if (!c) return;
    setFilter(c.dataset.fk, S.filters[c.dataset.fk] === c.dataset.fv ? '' : c.dataset.fv);
  };
}

function setFilter(k, v) {
  S.filters[k] = v;
  const qs = new URLSearchParams(Object.entries(S.filters).filter(([, val]) => val));
  const s = qs.toString();
  history.replaceState(null, '', '#/list' + (s ? '?' + s : ''));
  renderList();
}

/* ================================================================== */
/* Détail d'un carton                                                  */
/* ================================================================== */

async function renderBox(code) {
  let b;
  try { b = await api('/api/containers/' + encodeURIComponent(code)); }
  catch { view().innerHTML = `<div class="empty">${ICONS.box}<div>Code « ${esc(code)} » introuvable.</div><a class="btn" style="margin-top:14px" href="#/list">Voir la liste</a></div>`; return; }

  const st = S.meta.settings;
  view().innerHTML = `
    <div class="detail-head" style="margin-bottom:14px">
      <div style="flex:1;min-width:200px">
        <div class="bigcode">${esc(b.code)}</div>
        <div class="row" style="margin-top:8px;align-items:center">
          ${ownerBadge(b.owner)}
          <span class="pill ${esc(b.status)}">${esc(statusLabel(b.status))}</span>
          <span class="pill">${b.kind === 'item' ? '🪑 Objet' : '📦 Carton'}</span>
          ${b.tags.map(t => `<span class="pill ${t === 'fragile' ? 'frag' : 'tag'}">${tagDef(t).emoji} ${esc(tagDef(t).label)}</span>`).join('')}
        </div>
      </div>
      <div class="row">
        <label class="field" style="min-width:170px"><span>Format d’étiquette</span>
          <select id="bFormat">
            ${(S.meta.labelFormats || []).map(f => `<option value="${f.id}" ${st.labelFormat === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
          </select></label>
        <button class="btn primary" data-act="print">${ICONS.print} Imprimer</button>
        <button class="btn" data-act="preview">Aperçu</button>
      </div>
    </div>

    <div class="card pad stack" style="margin-bottom:14px">
      <label class="field"><span>Contenu</span>
        <input type="text" id="eTitle" value="${esc(b.title)}"></label>
      <label class="field"><span>Destination</span>
        <input type="text" id="eDest" list="destList" value="${esc(b.destination)}">
        <datalist id="destList">${st.destinations.map(d => `<option value="${esc(d)}">`).join('')}</datalist></label>
      <label class="field"><span>Propriétaire</span>
        <div class="owners" id="eOwner">
          ${['L', 'S', 'M'].map(o => `<button data-o="${o}" class="${b.owner === o ? 'on' : ''}">
            <span class="av" style="background:var(--${o})">${OWNER_INITIAL[o]}</span>${esc(S.meta.owners[o].name)}</button>`).join('')}
        </div></label>
      <label class="field"><span>Sigles</span>
        <div class="chips" id="eTags">
          ${S.meta.tags.map(t => `<span class="chip sm ${b.tags.includes(t.id) ? 'on' : ''}" data-tag="${t.id}">${t.emoji} ${esc(t.label)}</span>`).join('')}
        </div></label>
      <label class="field"><span>Statut</span>
        <div class="chips" id="eStatus">
          ${S.meta.statuses.map(s => `<span class="chip sm ${b.status === s.id ? 'on' : ''}" data-st="${s.id}" title="${esc(s.hint)}">${esc(s.label)}</span>`).join('')}
        </div></label>
      <label class="field"><span>Notes</span>
        <textarea id="eNotes">${esc(b.notes)}</textarea></label>
    </div>

    <div class="card pad stack" style="margin-bottom:14px">
      <div style="font-weight:700">Photos ${b.photos.length ? `<span class="muted small">(${b.photos.length})</span>` : ''}</div>
      <div class="photos" id="pGrid">
        ${b.photos.map(p => `<div class="p"><img loading="lazy" src="/photos/${esc(p.thumb)}" data-full="/photos/${esc(p.file)}" alt=""><button data-delp="${p.id}">✕</button></div>`).join('')}
        <button class="add" data-act="addphoto">${ICONS.cam}<span>Ajouter</span></button>
      </div>
      <input type="file" id="bCap" accept="image/*" capture="environment" multiple hidden>
    </div>

    <div class="card pad stack" style="margin-bottom:14px">
      <div style="font-weight:700">Détail du contenu</div>
      <ul class="items" id="bItems">
        ${b.items.map(i => `<li><span>${esc(i.label)}</span><button data-deli="${i.id}">✕</button></li>`).join('')
        || '<li class="muted">Aucun objet listé.</li>'}
      </ul>
      <input type="text" id="bAddItem" placeholder="Ajouter un objet puis Entrée…" autocomplete="off">
    </div>

    <div class="row" style="justify-content:space-between;align-items:center">
      <span class="small muted">Créé le ${new Date(b.created_at).toLocaleString('fr-FR')}${b.created_by ? ' par ' + esc(b.created_by) : ''}</span>
      <button class="btn danger" data-act="delete">Supprimer</button>
    </div>
  `;

  const patch = body => api(`/api/containers/${b.id}`, { method: 'PATCH', body });

  $('#eTitle').onchange = e => patch({ title: e.target.value }).then(() => toast('Enregistré'));
  $('#eDest').onchange = e => patch({ destination: e.target.value }).then(() => toast('Enregistré'));
  $('#eNotes').onchange = e => patch({ notes: e.target.value }).then(() => toast('Enregistré'));
  $('#eOwner').onclick = async e => {
    const t = e.target.closest('[data-o]'); if (!t) return;
    const r = await patch({ owner: t.dataset.o });
    toast(`Renuméroté en ${r.code}`, 'ok');
    location.hash = '#/box/' + encodeURIComponent(r.code);
  };
  $('#eTags').onclick = async e => {
    const t = e.target.closest('[data-tag]'); if (!t) return;
    const id = t.dataset.tag;
    const tags = b.tags.includes(id) ? b.tags.filter(x => x !== id) : b.tags.concat(id);
    b.tags = tags; t.classList.toggle('on');
    await patch({ tags });
  };
  $('#eStatus').onclick = async e => {
    const t = e.target.closest('[data-st]'); if (!t) return;
    await patch({ status: t.dataset.st });
    renderBox(b.code);
  };
  $('#bAddItem').onkeydown = async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = e.target.value.trim(); if (!v) return;
    e.target.value = '';
    await api(`/api/containers/${b.id}/items`, { method: 'POST', body: { labels: [v] } });
    renderBox(b.code);
  };
  $('#bItems').onclick = async e => {
    const t = e.target.closest('[data-deli]'); if (!t) return;
    await api('/api/items/' + t.dataset.deli, { method: 'DELETE' });
    renderBox(b.code);
  };
  $('#pGrid').onclick = async e => {
    const del = e.target.closest('[data-delp]');
    if (del) {
      if (!confirm('Supprimer cette photo ?')) return;
      await api('/api/photos/' + del.dataset.delp, { method: 'DELETE' });
      return renderBox(b.code);
    }
    const img = e.target.closest('img[data-full]');
    if (img) openLightbox(img.dataset.full);
  };
  $('#bCap').onchange = async e => {
    const fd = new FormData();
    for (const f of e.target.files) fd.append('photos', await shrink(f), 'photo.jpg');
    e.target.value = '';
    toast('Envoi…');
    await fetch(`/api/containers/${b.id}/photos`, { method: 'POST', headers: { 'X-User': S.user }, body: fd });
    renderBox(b.code);
  };

  view().onclick = async e => {
    const a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'addphoto') $('#bCap').click();
    const format = $('#bFormat') ? $('#bFormat').value : undefined;
    if (a.dataset.act === 'preview') {
      openLightbox(`/api/containers/${b.id}/label.png?format=${encodeURIComponent(format)}&t=` + Date.now());
    }
    if (a.dataset.act === 'print') {
      a.disabled = true;
      try {
        await api('/api/print/' + b.id, { method: 'POST', body: { copies: 1, format } });
        toast(`Étiquette ${formatShort(format)} envoyée à l’impression`, 'ok');
      } catch (err) { toast(err.message, 'err'); }
      a.disabled = false;
    }
    if (a.dataset.act === 'delete') {
      if (!confirm(`Supprimer définitivement ${b.code} et ses photos ?`)) return;
      await api('/api/containers/' + b.id, { method: 'DELETE' });
      toast(b.code + ' supprimé');
      location.hash = '#/list';
    }
  };
}

function openLightbox(src) {
  const lb = $('#lightbox');
  lb.querySelector('img').src = src;
  lb.classList.add('on');
  lb.onclick = () => lb.classList.remove('on');
}

/* ================================================================== */
/* Scanner                                                             */
/* ================================================================== */

let camStream = null, camLoop = null, zxReader = null;

function stopCamera() {
  if (camLoop) { cancelAnimationFrame(camLoop); camLoop = null; }
  if (zxReader) { try { zxReader.reset(); } catch {} zxReader = null; }
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
}

function renderScan() {
  const secure = window.isSecureContext;
  view().innerHTML = `
    <h2 class="title">Scanner un carton</h2>
    <p class="sub">Vise le code-barres de l’étiquette.</p>

    <div id="scanview"><video playsinline muted></video><div class="reticle"></div></div>

    <div class="stack" style="margin-top:14px">
      <button class="btn primary big" id="btnCamScan">${ICONS.scan} ${secure ? 'Activer la caméra' : 'Photographier le code-barres'}</button>
      ${!secure ? `<p class="small muted" style="margin:0">
        La caméra en direct nécessite une connexion sécurisée. Ouvre
        <b class="mono">https://${location.hostname}:3443</b> (accepte l’avertissement une fois)
        pour scanner en continu — sinon la photo fonctionne très bien.</p>` : ''}
      <input type="file" id="scanFile" accept="image/*" capture="environment" hidden>

      <hr class="hr">
      <label class="field"><span>Ou saisir le code à la main</span>
        <div class="row">
          <input type="text" id="manual" placeholder="L-042" class="mono" style="flex:1;text-transform:uppercase" autocomplete="off">
          <button class="btn" id="goManual">Ouvrir</button>
        </div>
      </label>
      <div id="scanRecent"></div>
    </div>
  `;

  $('#goManual').onclick = () => openCode($('#manual').value);
  $('#manual').onkeydown = e => { if (e.key === 'Enter') openCode(e.target.value); };
  $('#btnCamScan').onclick = () => secure ? startCamera() : $('#scanFile').click();
  $('#scanFile').onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    toast('Lecture du code…');
    const code = await decodeFromFile(f);
    if (code) openCode(code); else toast('Code-barres illisible, réessaie de plus près', 'err');
  };
}

async function startCamera() {
  const holder = $('#scanview');
  const vid = holder.querySelector('video');
  try {
    camStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false
    });
  } catch (e) { toast('Caméra refusée : ' + e.message, 'err'); return; }
  vid.srcObject = camStream;
  await vid.play();
  holder.classList.add('on');
  $('#btnCamScan').textContent = 'Caméra active…';

  if ('BarcodeDetector' in window) {
    const det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code', 'code_39', 'ean_13'] });
    const tick = async () => {
      if (!camStream) return;
      try {
        const codes = await det.detect(vid);
        if (codes.length) { stopCamera(); return openCode(codes[0].rawValue); }
      } catch {}
      camLoop = requestAnimationFrame(tick);
    };
    camLoop = requestAnimationFrame(tick);
  } else {
    await loadZXing();
    zxReader = new ZXing.BrowserMultiFormatReader();
    zxReader.decodeFromStream(camStream, vid, (res) => {
      if (res) { stopCamera(); openCode(res.getText()); }
    });
  }
}

let zxLoaded = null;
function loadZXing() {
  if (zxLoaded) return zxLoaded;
  zxLoaded = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = '/vendor/index.min.js';
    s.onload = res; s.onerror = () => rej(new Error('ZXing indisponible'));
    document.head.appendChild(s);
  });
  return zxLoaded;
}

async function decodeFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    if ('BarcodeDetector' in window) {
      const det = new window.BarcodeDetector({ formats: ['code_128', 'qr_code', 'code_39', 'ean_13'] });
      const bmp = await createImageBitmap(file);
      const codes = await det.detect(bmp);
      bmp.close();
      if (codes.length) return codes[0].rawValue;
    }
    await loadZXing();
    const r = new ZXing.BrowserMultiFormatReader();
    const res = await r.decodeFromImageUrl(url);
    return res && res.getText();
  } catch { return null; }
  finally { URL.revokeObjectURL(url); }
}

function openCode(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return;
  const recent = JSON.parse(localStorage.getItem('recentScans') || '[]').filter(c => c !== code);
  recent.unshift(code);
  localStorage.setItem('recentScans', JSON.stringify(recent.slice(0, 10)));
  location.hash = '#/box/' + encodeURIComponent(code);
}

/* ================================================================== */
/* File d'impression                                                   */
/* ================================================================== */

async function renderPrint() {
  const jobs = await api('/api/print');
  const st = S.meta.settings;
  const pending = jobs.filter(j => j.status === 'queued' || j.status === 'printing');

  const configured = (S.meta.labelFormats || [])
    .map(f => ({ f, name: f.id === 'shipping' ? st.shippingPrinter : st.printer }))
    .filter(x => x.name)
    .map(x => `${esc(x.f.short || x.f.label)} : <b>${esc(x.name)}</b>`);

  view().innerHTML = `
    <h2 class="title">Étiquettes</h2>
    <p class="sub">${configured.length ? configured.join(' · ') : '⚠️ Aucune imprimante configurée — <a href="#/settings">réglages</a>'}
      ${pending.length ? ` · ${pending.length} en attente` : ''}</p>

    <div class="card" style="margin-bottom:16px">
      ${jobs.length ? jobs.map(j => `
        <div class="job">
          <span class="st ${esc(j.status)}"></span>
          <div style="flex:1;min-width:0">
            <a href="#/box/${encodeURIComponent(j.code)}" style="font-weight:700;text-decoration:none">${esc(j.code)}</a>
            <span class="pill">${esc(formatShort(j.format || 'roll'))}</span>
            <div class="small muted">${new Date(j.created_at).toLocaleTimeString('fr-FR')}
              ${j.requested_by ? '· ' + esc(j.requested_by) : ''}
              ${j.printer ? '· ' + esc(j.printer) : ''}
              ${j.error ? '<br><span style="color:var(--danger)">' + esc(j.error) + '</span>' : ''}</div>
          </div>
          ${j.image ? `<button class="btn ghost" data-prev="/labels/${esc(j.image)}">Voir</button>` : ''}
          ${j.status === 'error' ? `<button class="btn" data-retry="${j.id}">Réessayer</button>` : ''}
          ${j.status !== 'printing' ? `<button class="btn ghost" data-del="${j.id}" title="Retirer">✕</button>` : ''}
        </div>`).join('') : '<div class="empty">Aucune impression pour l’instant.</div>'}
    </div>

    <div class="row">
      <a class="btn" href="/api/export.csv">⬇️ Export CSV de l’inventaire</a>
      <a class="btn" href="/api/export.json">⬇️ Export JSON</a>
    </div>
  `;

  view().onclick = async e => {
    const p = e.target.closest('[data-prev]');
    if (p) return openLightbox(p.dataset.prev + '?t=' + Date.now());
    const r = e.target.closest('[data-retry]');
    if (r) { await api(`/api/print/job/${r.dataset.retry}/retry`, { method: 'POST' }); return renderPrint(); }
    const d = e.target.closest('[data-del]');
    if (d) {
      try { await api('/api/print/job/' + d.dataset.del, { method: 'DELETE' }); } catch (err) { toast(err.message, 'err'); }
      renderPrint();
    }
  };
}

/* ================================================================== */
/* Réglages                                                            */
/* ================================================================== */

/* Les deux profils d'impression décrits une seule fois : l'écran de réglages en
   construit deux cartes identiques, chacune branchée sur ses propres réglages. */
const FORMAT_FIELDS = {
  roll: {
    prefix: 'r',
    printer: 'printer', paper: 'paperName', mode: 'labelMode',
    offX: 'offsetXMm', offY: 'offsetYMm',
    dims: [
      { key: 'labelWidthMm', label: 'Largeur du rouleau (mm)', min: 12, max: 120 },
      { key: 'panelHeightMm', label: 'Hauteur d’une face (mm)', min: 20, max: 150 },
      { key: 'foldGapMm', label: 'Zone blanche au pli (mm)', min: 0, max: 60 }
    ],
    fill: 'rollFillLength',
    note: 'La zone blanche se pose sur l’arête du carton : plus elle est large, plus le pli est tolérant.'
  },
  shipping: {
    prefix: 'k',
    printer: 'shippingPrinter', paper: 'shippingPaperName', mode: 'shippingMode',
    offX: 'shippingOffsetXMm', offY: 'shippingOffsetYMm',
    dims: [
      { key: 'shippingWidthMm', label: 'Largeur de l’étiquette (mm)', min: 40, max: 220 },
      { key: 'shippingHeightMm', label: 'Hauteur de l’étiquette (mm)', min: 40, max: 320 },
      { key: 'shippingFoldGapMm', label: 'Zone blanche au pli (mm)', min: 0, max: 60 }
    ],
    note: 'L’étiquette est prédécoupée : sa taille est imposée, les faces se partagent la hauteur. '
      + '4 × 6 pouces = 101,6 × 152,4 mm.'
  }
};

const formatDef = id => (S.meta.labelFormats || []).find(f => f.id === id) || { id, label: id, modes: [] };
const formatShort = id => formatDef(id).short || formatDef(id).label;

/* Même règle que le serveur (server/label.js), juste pour l'affichage : le rouleau
   s'allonge avec les faces, la 4×6 a une taille imposée que les faces se partagent. */
function labelSizeOf(format, v) {
  if (format === 'shipping') {
    const panels = v.shippingMode === 'single' ? 1 : 2;
    const total = Number(v.shippingHeightMm);
    return { w: Number(v.shippingWidthMm), total, panels };
  }
  const panels = v.labelMode === 'single' ? 1 : 2;
  const gap = panels === 1 ? 0 : Number(v.foldGapMm);
  return { w: Number(v.labelWidthMm), total: Number(v.panelHeightMm) * panels + gap, panels };
}

async function renderSettings() {
  const st = await api('/api/settings');
  S.meta.settings = st;
  const printers = await api('/api/printers');
  const formats = S.meta.labelFormats || [];
  // Une liste de formats par imprimante : interroger le pilote coûte ~1 s, on ne le
  // fait que pour les imprimantes réellement choisies.
  const papersByPrinter = {};
  for (const f of formats) {
    const name = st[FORMAT_FIELDS[f.id].printer];
    if (name && !(name in papersByPrinter)) {
      papersByPrinter[name] = await api('/api/papers?printer=' + encodeURIComponent(name));
    }
  }
  const addr = S.meta.addresses[0];

  const printerOptions = sel => `<option value="">— Aucune (générer l’aperçu seulement) —</option>`
    + printers.map(p => `<option value="${esc(p.name)}" ${sel === p.name ? 'selected' : ''}>${esc(p.name)}${p.isDefault ? ' (par défaut)' : ''}</option>`).join('');

  const formatCard = f => {
    const F = FORMAT_FIELDS[f.id];
    const p = F.prefix;
    const papers = papersByPrinter[st[F.printer]] || [];
    return `
    <div class="card pad stack" style="margin-bottom:16px">
      <div style="font-weight:700">${esc(f.label)}${st.labelFormat === f.id ? ' <span class="pill">par défaut</span>' : ''}</div>
      <p class="small muted" style="margin:-4px 0 0">${esc(f.hint)}</p>
      <div class="row">
        <label class="field" style="flex:1;min-width:220px"><span>Imprimante</span>
          <select id="${p}Printer">${printerOptions(st[F.printer])}</select></label>
        <label class="field" style="flex:1;min-width:220px"><span>Format du pilote</span>
          <select id="${p}Paper">
            <option value="">— Détection automatique par largeur —</option>
            ${papers.map(x => `<option value="${esc(x.name)}" ${st[F.paper] === x.name ? 'selected' : ''}>${esc(x.name)} — ${x.widthMm} × ${x.heightMm} mm</option>`).join('')}
          </select></label>
      </div>
      <label class="field"><span>Disposition</span>
        <select id="${p}Mode">
          ${f.modes.map(m => `<option value="${m.id}" ${st[F.mode] === m.id ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
        </select></label>
      <div class="row">
        ${F.dims.map(d => `<label class="field" style="flex:1;min-width:150px"><span>${esc(d.label)}</span>
          <input type="number" id="${p}_${d.key}" value="${st[d.key]}" min="${d.min}" max="${d.max}" step="0.5"></label>`).join('')}
      </div>
      ${F.fill ? `
      <label class="row" style="align-items:center;gap:10px">
        <input type="checkbox" id="${p}Fill" ${st[F.fill] ? 'checked' : ''} style="width:20px;height:20px">
        <span>Étirer les faces sur toute la longueur du format pilote</span>
      </label>
      <p class="small muted" style="margin:-4px 0 0">
        Le pilote n’imprime que des longueurs figées. Sans cette option, une bande plus
        courte que le format — c’est systématique en « 1 seule face » — sort centrée sur
        le ruban, avec une grosse marge blanche en haut et en bas.
      </p>` : ''}
      <div class="row">
        <label class="field" style="flex:1;min-width:150px"><span>Recalage horizontal (mm)</span>
          <input type="number" id="${p}OffX" value="${st[F.offX]}" min="-20" max="20" step="0.5"></label>
        <label class="field" style="flex:1;min-width:150px"><span>Recalage vertical (mm)</span>
          <input type="number" id="${p}OffY" value="${st[F.offY]}" min="-20" max="20" step="0.5"></label>
      </div>
      <p class="small muted" style="margin:-4px 0 0">
        Recalage : à ne toucher que si l’impression est décalée. Positif = vers la droite / vers le bas.
      </p>
      <div class="row" style="align-items:flex-start">
        <div class="labelprev"><img id="${p}Prev" alt="Aperçu de l’étiquette"></div>
        <div class="stack" style="flex:1;min-width:200px">
          <p class="small muted" style="margin:0">
            Étiquette demandée : <b id="${p}Total"></b>. ${esc(F.note)}
          </p>
          <div id="${p}Match" class="small" style="margin:0"></div>
          <button class="btn" data-testprint="${f.id}">${ICONS.print} Imprimer une étiquette de test</button>
        </div>
      </div>
    </div>`;
  };

  view().innerHTML = `
    <h2 class="title">Réglages</h2>
    <p class="sub">Tout est stocké en local sur ce PC.</p>

    <div class="card pad stack" style="margin-bottom:16px">
      <div style="font-weight:700">Impression</div>
      <label class="field"><span>Format utilisé par défaut</span>
        <select id="sFormat">
          ${formats.map(f => `<option value="${f.id}" ${st.labelFormat === f.id ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
        </select></label>
      <p class="small muted" style="margin:-4px 0 0">
        Format d’une étiquette lancée à l’unité — depuis la fiche d’un carton, ou à la
        fermeture si le kit ci-dessous est décoché.
      </p>
      <label class="row" style="align-items:center;gap:10px">
        <input type="checkbox" id="sAuto" ${st.autoPrintOnClose ? 'checked' : ''} style="width:20px;height:20px">
        <span>Imprimer automatiquement à la fermeture d’un carton</span>
      </label>
      <label class="field" style="max-width:220px"><span>Résolution du rendu (dpi)</span>
        <input type="number" id="sDpi" value="${st.dpi}" min="150" max="600" step="1"></label>
    </div>

    <div class="card pad stack" style="margin-bottom:16px">
      <div style="font-weight:700">Kit d’étiquettes</div>
      <p class="small muted" style="margin:-4px 0 0">
        Empilé, un carton ne montre qu’un ou deux côtés. Fermer un carton imprime donc
        un jeu complet : la grande étiquette 4×6 pour la face avant, plus des bandes du
        rouleau pour les autres côtés.
      </p>
      <label class="row" style="align-items:center;gap:10px">
        <input type="checkbox" id="sKit" ${st.kitOnClose ? 'checked' : ''} style="width:20px;height:20px">
        <span>Imprimer le kit complet à la fermeture d’un carton</span>
      </label>
      <label class="field" style="max-width:280px"><span>Petites étiquettes (rouleau) par carton</span>
        <input type="number" id="sKitCopies" value="${st.kitSmallCopies}" min="0" max="6" step="1"></label>
      <div id="kitSummary" class="small"></div>
    </div>

    ${formats.map(formatCard).join('')}

    <div class="card pad stack" style="margin-bottom:16px">
      <div style="font-weight:700">Destinations</div>
      <div class="chips" id="destEdit">
        ${st.destinations.map(d => `<span class="chip sm">${esc(d)} <b data-rmd="${esc(d)}" style="cursor:pointer;color:var(--danger);margin-left:4px">✕</b></span>`).join('')}
      </div>
      <input type="text" id="addDest" placeholder="Ajouter une pièce puis Entrée…">
    </div>

    <div class="card pad stack" style="margin-bottom:16px">
      <div style="font-weight:700">Raccourcis de contenu — perso</div>
      <p class="small muted" style="margin:-4px 0 0">
        Proposés quand le carton est à ${esc(S.meta.owners.L.name)} ou à ${esc(S.meta.owners.S.name)}.
      </p>
      <div class="chips" id="titleEditPerso">
        ${st.quickTitlesPerso.map(d => `<span class="chip sm">${esc(d)} <b data-rmt="${esc(d)}" style="cursor:pointer;color:var(--danger);margin-left:4px">✕</b></span>`).join('')}
      </div>
      <input type="text" id="addTitlePerso" placeholder="Ajouter un raccourci perso puis Entrée…">
    </div>

    <div class="card pad stack" style="margin-bottom:16px">
      <div style="font-weight:700">Raccourcis de contenu — mixte</div>
      <p class="small muted" style="margin:-4px 0 0">
        Proposés quand le carton est marqué ${esc(S.meta.owners.M.name)} : les objets communs.
      </p>
      <div class="chips" id="titleEditMixte">
        ${st.quickTitlesMixte.map(d => `<span class="chip sm">${esc(d)} <b data-rmt="${esc(d)}" style="cursor:pointer;color:var(--danger);margin-left:4px">✕</b></span>`).join('')}
      </div>
      <input type="text" id="addTitleMixte" placeholder="Ajouter un raccourci commun puis Entrée…">
    </div>

    <div class="card pad stack">
      <div style="font-weight:700">Accès depuis le mobile</div>
      ${addr ? `
        <div class="row" style="align-items:center">
          <img src="/api/qr.png?text=${encodeURIComponent('http://' + addr + ':' + location.port)}" width="150" height="150" style="border-radius:8px;background:#fff;padding:6px">
          <div>
            <p style="margin:0 0 6px">Scanne ce QR code avec le téléphone (même Wi-Fi) :</p>
            <p class="mono" style="margin:0 0 6px"><b>http://${esc(addr)}:${esc(location.port || '3000')}</b></p>
            <p class="small muted" style="margin:0">Puis « Ajouter à l’écran d’accueil » pour l’avoir comme une vraie app.<br>
            Pour le scan caméra en direct : <span class="mono">https://${esc(addr)}:3443</span></p>
          </div>
        </div>` : '<p class="muted">Aucune adresse réseau détectée.</p>'}
    </div>
  `;

  const save = async patch => {
    const s = await api('/api/settings', { method: 'PUT', body: patch });
    S.meta.settings = s;
    toast('Enregistré', 'ok');
    return s;
  };
  /* Une carte = un format : mêmes champs, mêmes réactions, seuls les réglages visés
     changent. `values` reprend ce qui est affiché à l'écran, pas ce qui est en base :
     l'aperçu doit suivre la saisie avant même l'enregistrement. */
  const cardValues = f => {
    const F = FORMAT_FIELDS[f.id];
    const v = { labelFormat: f.id, dpi: Number($('#sDpi').value) };
    v[F.mode] = $('#' + F.prefix + 'Mode').value;
    for (const d of F.dims) v[d.key] = Number($('#' + F.prefix + '_' + d.key).value);
    if (F.fill) v[F.fill] = $('#' + F.prefix + 'Fill').checked ? 1 : 0;
    return v;
  };

  const wireCard = f => {
    const F = FORMAT_FIELDS[f.id];
    const p = F.prefix;
    let matchToken = 0;

    const refreshMatch = async () => {
      const el = $('#' + p + 'Match');
      const v = cardValues(f);
      const size = labelSizeOf(f.id, v);
      if (!st[F.printer]) { el.innerHTML = '<span class="muted">Aucune imprimante sélectionnée.</span>'; return; }
      const token = ++matchToken;
      el.innerHTML = '<span class="muted">Interrogation du pilote…</span>';
      try {
        const qs = new URLSearchParams({ format: f.id, ...v });
        const r = await api('/api/paper-match?' + qs);
        if (token !== matchToken) return;

        if (!r.paper) {
          el.innerHTML = `<span style="color:var(--danger)">Aucun format de ${size.w} mm dans ce pilote.</span>`;
          return;
        }
        if (r.paper.fits === false) {
          el.innerHTML = `<span style="color:var(--danger)">Trop long : le plus grand format ${size.w} mm du pilote `
            + `fait ${r.paper.heightMm} mm. L’impression sera refusée.</span>`;
          return;
        }
        const paper = r.paper;
        const waste = paper.heightMm - r.printed.heightMm;
        const shrunk = r.scale < 0.999;
        // Étirée, la bande n'a plus la hauteur demandée : il faut dire laquelle sort.
        const filled = r.printed.heightMm > size.total + 0.5;
        el.innerHTML =
          `Format pilote : <b>${esc(paper.name)}</b> (${paper.widthMm} × ${paper.heightMm} mm)<br>`
          + `Zone imprimable : ${paper.printWMm} × ${paper.printHMm} mm<br>`
          + (shrunk || filled
            ? `<b>Imprimé : ${r.printed.widthMm.toFixed(1)} × ${r.printed.heightMm.toFixed(1)} mm</b> `
              + `<span class="muted">(`
              + (filled
                ? `faces étirées à ${r.printed.panelHeightMm.toFixed(1)} mm pour remplir le format`
                : `ajusté à ${Math.round(r.scale * 100)} %, la tête n’imprime pas jusqu’au bord`)
              + `)</span>`
            : `<b>Imprimé au 1:1</b>`)
          + (waste > 6 ? `<br><span class="muted">${waste.toFixed(0)} mm de support perdu par étiquette.</span>` : '');
      } catch { if (token === matchToken) el.innerHTML = ''; }
    };

    const refreshPreview = () => {
      const v = cardValues(f);
      const size = labelSizeOf(f.id, v);
      $('#' + p + 'Total').textContent = `${size.w} × ${size.total.toFixed(1)} mm`;
      fetch('/api/label/preview.png', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v)
      }).then(r => r.blob()).then(b => { $('#' + p + 'Prev').src = URL.createObjectURL(b); });
      refreshMatch();
    };

    $('#' + p + 'Printer').onchange = async e => {
      await save({ [F.printer]: e.target.value, [F.paper]: '' });
      renderSettings();
    };
    $('#' + p + 'Paper').onchange = async e => { await save({ [F.paper]: e.target.value }); refreshMatch(); };
    if (F.fill) {
      // L'aperçu est rendu par le serveur, qui relit le réglage : on enregistre d'abord.
      $('#' + p + 'Fill').onchange = async e => {
        await save({ [F.fill]: e.target.checked ? 1 : 0 });
        refreshPreview();
      };
    }
    for (const id of ['#' + p + 'OffX', '#' + p + 'OffY']) {
      $(id).onchange = () => save({
        [F.offX]: Number($('#' + p + 'OffX').value),
        [F.offY]: Number($('#' + p + 'OffY').value)
      });
    }
    for (const id of ['#' + p + 'Mode', ...F.dims.map(d => '#' + p + '_' + d.key)]) {
      $(id).oninput = refreshPreview;
      $(id).onchange = () => {
        const v = cardValues(f);
        delete v.labelFormat; delete v.dpi;
        save(v);
      };
    }
    return refreshPreview;
  };

  const refreshAll = formats.map(wireCard);
  refreshAll.forEach(fn => fn());

  /* Ce que chaque fermeture enverra vraiment, imprimante par imprimante : c'est ici
     qu'on voit qu'il manque l'une des deux, pas devant le carton scotché. */
  const kitSummary = () => {
    const plan = closePlan();
    const cur = S.meta.settings;
    const el = $('#kitSummary');
    if (!plan.auto) {
      el.innerHTML = '<span class="muted">Impression automatique désactivée : les étiquettes '
        + 'ne partiront qu’à la demande, depuis la fiche d’un carton.</span>';
      return;
    }
    /* Une bande porte 2 faces sauf en « 1 seule face » : 3 bandes ne font pas
       forcément 3 étiquettes, autant le dire avant de choisir le nombre. */
    const perStrip = {
      fold: '2 faces à plier sur l’arête',
      mirror: '2 faces tête-bêche à découper',
      single: '1 face'
    }[cur.labelMode] || '2 faces';
    const faces = cur.labelMode === 'single' ? 1 : 2;
    el.innerHTML = 'Chaque fermeture enverra <b>' + esc(planText(plan)) + '</b> :<br>'
      + plan.parts.map(p => p.printer
        ? `• ${p.n} × ${esc(formatShort(p.format))} → ${esc(p.printer)}`
        : `• <span style="color:var(--danger)">${p.n} × ${esc(formatShort(p.format))} → aucune imprimante, simple aperçu</span>`
      ).join('<br>')
      + (plan.small
        ? `<br><span class="muted">Une bande = ${perStrip}, donc ${plan.small} bandes `
          + `= ${plan.small * faces} côtés couverts.</span>`
        : '');
  };
  kitSummary();

  $('#sKit').onchange = async e => { await save({ kitOnClose: e.target.checked }); kitSummary(); };
  $('#sKitCopies').onchange = async e => {
    // Le champ accepte la frappe libre : on borne ici plutôt que de laisser le
    // serveur refuser l'enregistrement sur une valeur tapée de travers.
    const n = Math.max(0, Math.min(6, Math.round(Number(e.target.value) || 0)));
    e.target.value = n;
    await save({ kitSmallCopies: n });
    kitSummary();
  };

  $('#sFormat').onchange = async e => { await save({ labelFormat: e.target.value }); renderSettings(); };
  $('#sAuto').onchange = async e => { await save({ autoPrintOnClose: e.target.checked }); kitSummary(); };
  $('#sDpi').oninput = () => refreshAll.forEach(fn => fn());
  $('#sDpi').onchange = () => save({ dpi: Number($('#sDpi').value) });

  view().onclick = async e => {
    const b = e.target.closest('[data-testprint]');
    if (!b) return;
    b.disabled = true;
    try {
      const list = await api('/api/containers');
      if (!list.length) toast('Crée d’abord un carton pour tester', 'err');
      else {
        await api('/api/print/' + list[0].id, { method: 'POST', body: { format: b.dataset.testprint } });
        toast('Test envoyé en ' + formatShort(b.dataset.testprint), 'ok');
      }
    } catch (err) { toast(err.message, 'err'); }
    b.disabled = false;
  };

  $('#addDest').onkeydown = async e => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    e.preventDefault();
    await save({ destinations: S.meta.settings.destinations.concat(e.target.value.trim()) });
    renderSettings();
  };
  $('#destEdit').onclick = async e => {
    const b = e.target.closest('[data-rmd]'); if (!b) return;
    await save({ destinations: S.meta.settings.destinations.filter(d => d !== b.dataset.rmd) });
    renderSettings();
  };
  for (const [key, add, edit] of [
    ['quickTitlesPerso', '#addTitlePerso', '#titleEditPerso'],
    ['quickTitlesMixte', '#addTitleMixte', '#titleEditMixte']
  ]) {
    $(add).onkeydown = async e => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return;
      e.preventDefault();
      await save({ [key]: S.meta.settings[key].concat(e.target.value.trim()) });
      renderSettings();
    };
    $(edit).onclick = async e => {
      const b = e.target.closest('[data-rmt]'); if (!b) return;
      await save({ [key]: S.meta.settings[key].filter(d => d !== b.dataset.rmt) });
      renderSettings();
    };
  }
}

/* ================================================================== */

/**
 * Le serveur ne répond pas. Deux causes très différentes, et de loin :
 *  - il est simplement éteint : la coquille hors-ligne s'affiche, c'est normal ;
 *  - la page vient du cache d'un service worker devenu inutilisable — sur l'origine
 *    HTTPS au certificat auto-signé, un certificat regénéré suffit à casser toute
 *    l'app alors que le serveur, lui, tourne. Sans bouton, il faut aller vider les
 *    données de site dans les réglages du téléphone : personne ne trouve.
 * D'où le bouton de remise à zéro, et le repli vers l'adresse HTTP (port 3000), qui
 * n'a ni certificat ni service worker.
 */
boot().catch(e => {
  const httpUrl = 'http://' + location.hostname + ':3000/';
  document.body.innerHTML = `<div class="empty" style="padding:48px 20px;line-height:1.6">
    <b>Impossible de joindre le serveur.</b><br>
    <span class="small">${esc(e.message)}</span><br><br>
    <span class="small">Vérifie que le PC est allumé, que <b>Demarrer.bat</b> tourne,
    et que le téléphone est sur le même Wi-Fi.</span><br><br>
    <button class="btn" id="btnReset">🧹 Vider le cache de l’app et recharger</button>
    ${location.protocol === 'https:'
      ? `<br><br><span class="small">Ou passe par l’adresse simple, sans certificat :<br>
         <a href="${httpUrl}">${esc(httpUrl)}</a> <span class="muted">(tout marche, sauf le scan caméra en direct)</span></span>`
      : ''}
  </div>`;
  const btn = document.getElementById('btnReset');
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    btn.textContent = 'Nettoyage…';
    try {
      if (navigator.serviceWorker) {
        for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      }
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch {}
    location.reload();
  };
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
