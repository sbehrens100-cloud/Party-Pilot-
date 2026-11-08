#!/usr/bin/env node
/*
 * Baut eine einzelne, eigenständige HTML-Datei (Kundenansicht) zum Öffnen ohne Server.
 * - Dienstleister: nur öffentliche Felder (wie /api/public), aus einer laufenden Instanz oder dem Seed
 * - Beispielbilder als data:-URIs eingebettet
 * - Anfragen werden nur im Browser (localStorage) gespeichert, Admin ist deaktiviert
 * Aufruf: node tools/build-standalone.js <public.json> <ausgabe.html>
 */
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const [, , pubFile, outFile] = process.argv;
if (!pubFile || !outFile) { console.error('Aufruf: node tools/build-standalone.js <public.json> <ausgabe.html>'); process.exit(1); }

const pub = JSON.parse(fs.readFileSync(pubFile, 'utf8'));
const data = { providers: pub.providers, set: pub.set, busy: [], admin: false };

let html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

const imgDir = path.join(root, 'public', 'img', 'opts');
const imgs = {};
for (const f of fs.readdirSync(imgDir).filter(f => f.endsWith('.jpg')).sort())
  imgs[f.replace(/\.jpg$/, '')] = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(imgDir, f)).toString('base64');

const oldDef = "const defImg=k=>DEF_IMG.has(k)?'/img/opts/'+k.replace(':','-')+'.jpg':'';";
if (!html.includes(oldDef)) throw new Error('defImg nicht gefunden – Build-Skript anpassen.');
html = html.replace(oldDef, "const defImg=k=>DEF_IMG.has(k)?(window.PP_IMG[k.replace(':','-')]||''):'';");

const shim = `<script>
/* Offline-Demo: ersetzt den Server */
window.PP_IMG=${JSON.stringify(imgs)};
(function(){
  const DATA=${JSON.stringify(data)};
  const KEY='partypilot-demo-anfragen';
  const load=()=>{try{return JSON.parse(localStorage.getItem(KEY))||[]}catch(e){return[]}};
  const store=a=>{try{localStorage.setItem(KEY,JSON.stringify(a))}catch(e){}};
  const json=(code,obj)=>new Response(JSON.stringify(obj),{status:code,headers:{'Content-Type':'application/json'}});
  const now=()=>new Date().toLocaleString('de-DE',{day:'2-digit',month:'2-digit',year:'2-digit',hour:'2-digit',minute:'2-digit'});
  const realFetch=window.fetch.bind(window);
  window.fetch=async function(url,opts){
    const p=String(url);if(!p.startsWith('/api/'))return realFetch(url,opts);
    const m=(opts&&opts.method)||'GET',body=opts&&opts.body?JSON.parse(opts.body):{};
    if(p==='/api/public')return json(200,DATA);
    if(p==='/api/request'&&m==='POST'){
      const b=body.brief||{},co=body.co||{},items=body.items||[];
      if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(b.date)))return json(400,{error:'Datum fehlt.'});
      if(!co.name||!/\\S+@\\S+\\.\\S+/.test(co.email||'')||!co.phone)return json(400,{error:'Name, E-Mail und Telefon sind Pflicht.'});
      if(!co.privacy)return json(400,{error:'Bitte der Datenverarbeitung zustimmen.'});
      if(!items.length)return json(400,{error:'Keine Bausteine gewählt.'});
      const k={id:'DEMO-'+(1000+Math.floor(Math.random()*9000)),stage:'neu',bookedAt:null,created:now(),brief:b,customer:{name:co.name},email:String(co.email).toLowerCase(),
        items:items.map(i=>({cat:i.cat,name:(DATA.providers.find(x=>x.id===String(i.pid).split('#')[0])||{}).name||'',price:Math.round(+i.price||0),status:'offen',detail:i.detail||''})),checks:{}};
      const all=load();all.unshift(k);store(all);
      const {email,...pubK}=k;return json(200,{booking:pubK});
    }
    if(p==='/api/track'&&m==='POST'){
      const k=load().find(x=>x.id===String(body.id||'').trim().toUpperCase()&&x.email===String(body.mail||'').trim().toLowerCase());
      if(!k)return json(200,{booking:null});const {email,...pubK}=k;return json(200,{booking:pubK});
    }
    return json(403,{error:'In der Offline-Demo nicht verfügbar. Den Admin-Bereich gibt es nur auf der Website.'});
  };
  document.addEventListener('DOMContentLoaded',()=>{const d=document.createElement('div');
    d.textContent='Demo-Version: Anfragen werden nur in diesem Browser gespeichert und nicht verschickt.';
    d.style.cssText='position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:9999;background:#2b2620;color:#f6f1e8;font:600 12px/1.3 Manrope,system-ui,sans-serif;padding:6px 12px;border-radius:999px;opacity:.85;pointer-events:none;max-width:92vw;text-align:center';
    document.body.appendChild(d)});
})();
</script>
`;
const i = html.indexOf('<script>');
html = html.slice(0, i) + shim + html.slice(i);
fs.writeFileSync(outFile, html);
console.log('Geschrieben:', outFile, (fs.statSync(outFile).size / 1048576).toFixed(1) + ' MB,', Object.keys(imgs).length, 'Bilder,', data.providers.length, 'Dienstleister');
