/* =====================================================================
   PartyPilot – Server
   - liefert die App (public/index.html) aus
   - speichert alle Daten in einer JSON-Datei auf dem Railway-Volume (/data)
   - echter Admin-Login (Passwort-Hash + HttpOnly-Session-Cookie)
   - Kunden bekommen nur öffentliche Felder (keine Kontakte, Provisionen, Notizen)
   Keine externen Abhängigkeiten, nur Node.js (>= 18).
   ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DEFAULT_PROVIDERS } = require('./seed');

const PORT = +process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'partypilot-db.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_DAYS = 30;
const MAX_BODY = 8 * 1024 * 1024;
const COOKIE = 'pp_session';
const IS_PROD = !!process.env.RAILWAY_ENVIRONMENT || process.env.NODE_ENV === 'production';

const DEFAULT_SET = {
  fee: 4, feeCap: 149, bundle: 3, bundleMin: 4, deposit: 30, onlyPartners: false, replyHours: 24,
  comm: { location: 8, catering: 10, getraenke: 10, dj: 12, foto: 12, deko: 15, personal: 8 },
  costs: { 'Hosting & Software': 30, 'Versicherung': 40, 'Marketing / Werbung': 300, 'Telefon & Sonstiges': 40 },
  calc: { events: 4, value: 4000 },
  company: { name: 'PartyPilot', mail: '', tel: '' }
};
const CATS = ['location', 'catering', 'getraenke', 'dj', 'foto', 'deko', 'personal'];

/* ---------- Datenhaltung ---------- */
const clone = o => JSON.parse(JSON.stringify(o));
let DB = null;

function hashPw(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return { salt, hash };
}
function checkPw(pw, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const h = crypto.scryptSync(String(pw), rec.salt, 64);
  const ref = Buffer.from(rec.hash, 'hex');
  return h.length === ref.length && crypto.timingSafeEqual(h, ref);
}

function loadDB() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    try {
      DB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) {
      console.error('DB-Datei defekt, versuche Backup:', e.message);
      DB = JSON.parse(fs.readFileSync(DB_FILE + '.bak', 'utf8'));
    }
  } else {
    DB = { rev: 1, providers: clone(DEFAULT_PROVIDERS), bookings: [], set: clone(DEFAULT_SET), demoRemoved: false, auth: { sessions: {} } };
    console.log('Neue Datenbank mit', DB.providers.length, 'Dienstleistern angelegt:', DB_FILE);
  }
  DB.rev = DB.rev || 1;
  DB.providers = DB.providers || [];
  DB.bookings = DB.bookings || [];
  DB.set = Object.assign(clone(DEFAULT_SET), DB.set || {});
  delete DB.set.pin;
  DB.auth = DB.auth || {};
  DB.auth.sessions = DB.auth.sessions || {};
  // Passwort: aus ADMIN_PASSWORD (Railway-Variable), falls noch keins gesetzt oder ADMIN_PASSWORD_RESET=1
  if (process.env.ADMIN_PASSWORD && (!DB.auth.pw || process.env.ADMIN_PASSWORD_RESET === '1')) {
    DB.auth.pw = hashPw(process.env.ADMIN_PASSWORD);
    DB.auth.sessions = {};
    console.log('Admin-Passwort aus ADMIN_PASSWORD übernommen.');
  }
  if (!DB.auth.pw) console.warn('WARNUNG: Kein Admin-Passwort gesetzt. Setze die Variable ADMIN_PASSWORD.');
  saveDB();
}

function saveDB() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DB));
  if (fs.existsSync(DB_FILE)) fs.copyFileSync(DB_FILE, DB_FILE + '.bak');
  fs.renameSync(tmp, DB_FILE);
}
function dailyBackup() {
  try {
    const dir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const name = 'partypilot-' + new Date().toISOString().slice(0, 10) + '.json';
    const target = path.join(dir, name);
    if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify(DB));
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort();
    while (files.length > 30) fs.unlinkSync(path.join(dir, files.shift()));
  } catch (e) { console.error('Backup fehlgeschlagen:', e.message); }
}

const adminDB = () => ({ rev: DB.rev, providers: DB.providers, bookings: DB.bookings, set: DB.set, demoRemoved: !!DB.demoRemoved });

/* ---------- Öffentliche Sicht (für Kunden) ---------- */
const PUBLIC_P_FIELDS = ['id', 'cat', 'name', 'city', 'desc', 'tags', 'cap', 'kitchen', 'ext', 'inhouse', 'diets', 'mobile', 'km', 'maxG', 'status', 'blocked', 'reviews'];
function publicProvider(p) {
  const o = {};
  PUBLIC_P_FIELDS.forEach(k => { if (p[k] !== undefined) o[k] = p[k]; });
  const pr = p.price || {};
  o.price = {};
  ['base', 'pp', 'min', 'hourly'].forEach(k => { if (pr[k] != null) o.price[k] = pr[k]; });
  o.reviews = (p.reviews || []).map(Number);
  return o;
}
function publicSet() {
  const s = DB.set;
  return { fee: s.fee, feeCap: s.feeCap, bundle: s.bundle, bundleMin: s.bundleMin, deposit: s.deposit, onlyPartners: s.onlyPartners, replyHours: s.replyHours, company: { name: s.company.name } };
}
function busyList() {
  const out = [];
  DB.bookings.forEach(k => {
    if (k.stage === 'storniert' || k.stage === 'neu' || !k.brief) return;
    (k.items || []).forEach(i => { if (i.status !== 'abgelehnt') out.push({ pid: String(i.pid).split('#')[0], date: k.brief.date, k: k.id }); });
  });
  return out;
}
function publicBooking(k) {
  return {
    id: k.id, stage: k.stage, bookedAt: k.bookedAt || null, created: k.created,
    brief: k.brief, customer: { name: k.customer && k.customer.name },
    items: (k.items || []).map(i => ({ cat: i.cat, name: i.name, price: i.price, status: i.status })),
    checks: k.checks || {}
  };
}

/* ---------- Hilfen ---------- */
function send(res, code, body, headers) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(code, Object.assign({
    'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY'
  }, headers || {}));
  res.end(isStr ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Zu groß'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('Ungültiges JSON'), { code: 400 })); } });
    req.on('error', reject);
  });
}
function cookies(req) {
  const out = {};
  String(req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return out;
}
const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');
function isAdmin(req) {
  const t = cookies(req)[COOKIE];
  if (!t) return false;
  const s = DB.auth.sessions[tokenHash(t)];
  if (!s) return false;
  if (s.exp < Date.now()) { delete DB.auth.sessions[tokenHash(t)]; return false; }
  return true;
}
function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}` + (IS_PROD ? '; Secure' : '');
}
function sameOrigin(req) {
  // Schutz gegen CSRF bei schreibenden Anfragen
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch (e) { return false; }
}
const clientIp = req => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(); const h = hits.get(key) || { n: 0, t: now };
  if (now - h.t > windowMs) { h.n = 0; h.t = now; }
  h.n++; hits.set(key, h);
  return h.n > max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (now - h.t > 3600e3) hits.delete(k); }, 600e3).unref();

const nowStr = () => new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
function newId() { let id; do { id = 'PP-' + (1000 + crypto.randomInt(9000)); } while (DB.bookings.some(k => k.id === id)); return id; }
const str = (v, n) => String(v == null ? '' : v).slice(0, n || 500);
const commOf = p => (p && p.comm != null && p.comm !== '') ? +p.comm : (DB.set.comm[p && p.cat] || 0);

/* ---------- Kunden-Anfrage anlegen ---------- */
function createRequest(body) {
  const b = body.brief || {}, co = body.co || {}, items = Array.isArray(body.items) ? body.items : [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.date))) throw new Error('Datum fehlt.');
  if (!(+b.guests >= 10 && +b.guests <= 400)) throw new Error('Gästezahl ungültig.');
  if (!str(co.name).trim() || !/\S+@\S+\.\S+/.test(str(co.email)) || !str(co.phone).trim()) throw new Error('Name, E-Mail und Telefon sind Pflicht.');
  if (!co.privacy) throw new Error('Bitte der Datenverarbeitung zustimmen.');
  if (!items.length || items.length > 7) throw new Error('Keine Bausteine gewählt.');
  const brief = {
    occasion: str(b.occasion, 80), date: str(b.date, 10), start: str(b.start, 5), hours: +b.hours || 6, city: str(b.city, 80), radius: +b.radius || 25,
    guests: +b.guests, budget: +b.budget || 0, style: str(b.style, 40), diets: (Array.isArray(b.diets) ? b.diets : []).map(x => str(x, 30)).slice(0, 8),
    cats: Object.fromEntries(CATS.map(c => [c, !!(b.cats && b.cats[c])]))
  };
  const outItems = [];
  for (const it of items) {
    const pid = str(it.pid, 60), baseId = pid.split('#')[0];
    const p = DB.providers.find(x => x.id === baseId);
    if (!p || !CATS.includes(it.cat)) throw new Error('Unbekannter Dienstleister.');
    const virtual = pid.includes('#gastro');
    const name = virtual ? p.name + ' – Hausgastronomie' : p.name;
    const comm = virtual ? ((p.comm != null && p.comm !== '') ? +p.comm : DB.set.comm.catering) : commOf(p);
    outItems.push({ cat: it.cat, pid, name, price: Math.max(0, Math.round(+it.price || 0)), calc: str(it.calc, 200), comm, status: 'offen', paid: false, rating: null });
  }
  const customer = {
    type: co.type === 'Firma' ? 'Firma' : 'Privat', name: str(co.name, 120), email: str(co.email, 160), phone: str(co.phone, 60), company: str(co.company, 160),
    address: str(co.address, 400), vat: str(co.vat, 40), po: str(co.po, 60), msg: str(co.msg, 2000), privacy: true
  };
  DB.rev++;
  const k = { id: newId(), created: nowStr(), createdAt: new Date().toISOString(), _rev: DB.rev, example: false, stage: 'neu', brief, customer, items: outItems, checks: {}, log: [{ t: nowStr(), txt: 'Anfrage über die Website eingegangen.' }], feePaid: false };
  DB.bookings.unshift(k);
  saveDB();
  return k;
}

/* ---------- Admin speichert komplette Datenbank ---------- */
function saveAdminDB(body) {
  if (!Array.isArray(body.providers) || !Array.isArray(body.bookings)) throw new Error('Ungültige Daten.');
  const baseRev = +body.baseRev || 0;
  const ids = new Set(body.bookings.map(k => k.id));
  // Anfragen, die nach dem letzten Laden reinkamen, nicht überschreiben
  const incoming = DB.bookings.filter(k => !ids.has(k.id) && (k._rev || 0) > baseRev);
  const set = Object.assign(clone(DEFAULT_SET), body.set || {});
  delete set.pin;
  DB.rev++;
  DB.providers = body.providers;
  DB.bookings = incoming.concat(body.bookings);
  DB.set = set;
  DB.demoRemoved = !!body.demoRemoved;
  saveDB();
  return incoming.length;
}

/* ---------- Statische Dateien ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };
function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 403, 'Verboten');
  fs.readFile(full, (err, data) => {
    if (err) {
      // SPA-Fallback
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => e2 ? send(res, 404, 'Nicht gefunden') : send(res, 200, d2, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' }));
    }
    send(res, 200, data, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': path.extname(full) === '.html' ? 'no-cache' : 'public, max-age=3600' });
  });
}

/* ---------- Router ---------- */
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname, m = req.method;

  if (p === '/healthz') return send(res, 200, { ok: true });
  if (!p.startsWith('/api/')) {
    if (m !== 'GET' && m !== 'HEAD') return send(res, 405, 'Nicht erlaubt');
    return serveStatic(req, res, p);
  }
  if (m !== 'GET' && !sameOrigin(req)) return send(res, 403, { error: 'Fremde Herkunft' });

  try {
    // --- öffentlich ---
    if (p === '/api/public' && m === 'GET') {
      return send(res, 200, { providers: DB.providers.filter(x => x.status !== 'Pausiert').map(publicProvider), set: publicSet(), busy: busyList(), admin: isAdmin(req) });
    }
    if (p === '/api/request' && m === 'POST') {
      if (limited('req:' + clientIp(req), 10, 3600e3)) return send(res, 429, { error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
      const body = await readBody(req);
      const k = createRequest(body);
      console.log('Neue Anfrage', k.id, k.brief.occasion, k.brief.date);
      return send(res, 200, { booking: publicBooking(k) });
    }
    if (p === '/api/track' && m === 'POST') {
      if (limited('track:' + clientIp(req), 30, 600e3)) return send(res, 429, { error: 'Zu viele Versuche. Bitte warte 10 Minuten.' });
      const body = await readBody(req);
      const id = str(body.id, 20).trim().toUpperCase(), mail = str(body.mail, 160).trim().toLowerCase();
      const k = DB.bookings.find(x => x.id === id && String(x.customer && x.customer.email).toLowerCase() === mail);
      return send(res, 200, { booking: k ? publicBooking(k) : null });
    }
    if (p === '/api/login' && m === 'POST') {
      if (limited('login:' + clientIp(req), 8, 900e3)) return send(res, 429, { error: 'Zu viele Versuche. Bitte warte 15 Minuten.' });
      const body = await readBody(req);
      if (!DB.auth.pw) return send(res, 503, { error: 'Kein Admin-Passwort eingerichtet (Variable ADMIN_PASSWORD auf Railway setzen).' });
      if (!checkPw(body.password || '', DB.auth.pw)) return send(res, 401, { error: 'Passwort falsch.' });
      const token = crypto.randomBytes(32).toString('hex');
      DB.auth.sessions[tokenHash(token)] = { exp: Date.now() + SESSION_DAYS * 864e5, created: new Date().toISOString() };
      for (const [h, s] of Object.entries(DB.auth.sessions)) if (s.exp < Date.now()) delete DB.auth.sessions[h];
      saveDB();
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token, SESSION_DAYS * 86400) });
    }
    if (p === '/api/logout' && m === 'POST') {
      const t = cookies(req)[COOKIE];
      if (t) { delete DB.auth.sessions[tokenHash(t)]; saveDB(); }
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
    }

    // --- nur Admin ---
    if (p.startsWith('/api/admin/')) {
      if (!isAdmin(req)) return send(res, 401, { error: 'Nicht angemeldet.' });
      if (p === '/api/admin/db' && m === 'GET') return send(res, 200, adminDB());
      if (p === '/api/admin/db' && m === 'PUT') {
        const body = await readBody(req);
        const merged = saveAdminDB(body);
        return send(res, 200, Object.assign(adminDB(), { merged }));
      }
      if (p === '/api/admin/password' && m === 'POST') {
        const body = await readBody(req);
        if (!checkPw(body.old || '', DB.auth.pw)) return send(res, 400, { error: 'Aktuelles Passwort falsch.' });
        if (String(body.new || '').length < 10) return send(res, 400, { error: 'Neues Passwort: mindestens 10 Zeichen.' });
        DB.auth.pw = hashPw(body.new);
        const t = cookies(req)[COOKIE], keep = t && DB.auth.sessions[tokenHash(t)];
        DB.auth.sessions = keep ? { [tokenHash(t)]: keep } : {};
        saveDB();
        return send(res, 200, { ok: true });
      }
      if (p === '/api/admin/default-providers' && m === 'GET') return send(res, 200, { providers: clone(DEFAULT_PROVIDERS) });
    }
    return send(res, 404, { error: 'Nicht gefunden' });
  } catch (e) {
    const code = e.code === 413 || e.code === 400 ? e.code : 400;
    if (!(e.message || '').match(/[a-zäöü]/i)) console.error(e);
    return send(res, code, { error: e.message || 'Fehler' });
  }
}

loadDB();
dailyBackup();
setInterval(dailyBackup, 6 * 3600e3).unref();
http.createServer((req, res) => { handle(req, res).catch(e => { console.error(e); try { send(res, 500, { error: 'Serverfehler' }); } catch (_) {} }); })
  .listen(PORT, () => console.log(`PartyPilot läuft auf Port ${PORT}, Daten in ${DB_FILE}`));
