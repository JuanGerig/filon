// Filón — genera el sitio estático a partir de Airtable.
// Uso: AIRTABLE_TOKEN=pat... node scripts/build.mjs   (sin dependencias; Node 18 o superior)
// Sin AIRTABLE_TOKEN usa los CSV de datos-ejemplo/ para poder probar.

import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const RAIZ = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SALIDA = path.join(RAIZ, '_site');
const avisos = [];

// ---------- utilidades ----------

// "Presupuesto gastado" -> "presupuesto_gastado"; "Anfitrión" -> "anfitrion"
function normalizarClave(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// Acepta 1000 · 1.000 · 1,000 · 1,50 · 1.5 · $1K · 2,5k · 10 %
function numero(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[\s$€%]|usdt?|eur/gi, '');
  if (!s) return null;
  let mult = 1;
  if (/k$/i.test(s)) { mult = 1000; s = s.slice(0, -1); }
  const coma = s.includes(','), punto = s.includes('.');
  if (coma && punto) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (coma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (punto && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s) * mult;
  return Number.isFinite(n) ? n : null;
}

// AAAA-MM-DD o DD/MM/AAAA -> AAAA-MM-DD
function fecha(v) {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const esURL = v => /^https?:\/\/\S+$/i.test(v || '');
const lista = v => (Array.isArray(v) ? v : String(v || '').split(/[,;/]/)).map(x => String(x).trim()).filter(Boolean);
const verdadero = v => v === true || /^(si|sí|s|1|true|x)$/i.test(String(v ?? '').trim());

// ---------- fuentes ----------

async function leerAirtable(base, tabla, token) {
  const filas = [];
  let offset;
  do {
    const url = new URL(`https://api.airtable.com/v0/${base}/${encodeURIComponent(tabla)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const pista = res.status === 401
        ? ` | El token recibido empieza por "${token.slice(0, 3)}" y tiene ${token.length} caracteres; uno de Airtable empieza por "pat" y suele tener 82. Revisa el secreto AIRTABLE_TOKEN.`
        : '';
      throw new Error(`Airtable "${tabla}" respondió ${res.status}: ${await res.text()}${pista}`);
    }
    const json = await res.json();
    for (const r of json.records) {
      const obj = { _fila: r.id };
      for (const [k, v] of Object.entries(r.fields)) obj[normalizarClave(k)] = v;
      filas.push(obj);
    }
    offset = json.offset;
  } while (offset);
  return filas;
}

// CSV estándar (solo para los datos de ejemplo)
function parsearCSV(texto) {
  const filas = [];
  let fila = [], campo = '', comillas = false;
  texto = texto.replace(/^﻿/, '');
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const limpias = filas.filter(f => f.some(v => v.trim() !== ''));
  if (!limpias.length) return [];
  const cabecera = limpias[0].map(normalizarClave);
  return limpias.slice(1).map((f, n) => {
    const obj = { _fila: `fila ${n + 2}` };
    cabecera.forEach((k, i) => { if (k) obj[k] = (f[i] ?? '').trim(); });
    return obj;
  });
}

// ---------- transformación ----------

function prepararPlataformas(filas) {
  const mapa = {};
  for (const f of filas) {
    if (!f.plataforma) continue;
    mapa[normalizarClave(f.plataforma)] = {
      nombre: f.plataforma,
      web: esURL(f.web) ? f.web : null,
      comision_pct: numero(f.comision),
      minimo_retiro: f.minimo_de_retiro || null,
      metodos_cobro: f.metodos_de_cobro || null,
      paises: f.paises || null,
    };
  }
  return mapa;
}

function prepararCampanas(filas, plataformas) {
  const salida = [];
  for (const f of filas) {
    if (!verdadero(f.activa)) continue;

    const faltan = ['plataforma', 'nombre', 'enlace', 'cpm'].filter(k => f[k] == null || f[k] === '');
    if (faltan.length) { avisos.push(`${f._fila} "${f.nombre || ''}": falta ${faltan.join(', ')}; no se publica`); continue; }
    if (!esURL(f.enlace)) { avisos.push(`${f._fila} "${f.nombre}": el enlace no empieza por http; no se publica`); continue; }

    const cpm = numero(f.cpm);
    if (cpm == null || cpm <= 0) { avisos.push(`${f._fila} "${f.nombre}": CPM no válido; no se publica`); continue; }

    const plat = plataformas[normalizarClave(f.plataforma)];
    if (!plat) avisos.push(`${f._fila} "${f.nombre}": la plataforma "${f.plataforma}" no está en Plataformas`);
    const comision = plat?.comision_pct ?? null;

    const total = numero(f.presupuesto_total);
    const gastado = numero(f.presupuesto_gastado) ?? 0;
    const restante = total != null ? Math.max(total - gastado, 0) : null;
    if (total != null && restante <= 0) continue; // agotada: fuera del listado

    salida.push({
      id: `${normalizarClave(f.plataforma)}-${normalizarClave(f.nombre)}`.slice(0, 80),
      plataforma: plat?.nombre || f.plataforma,
      nombre: f.nombre,
      anfitrion: f.anfitrion || null,
      enlace: f.enlace,
      moneda: String(f.moneda || 'USD').toUpperCase(),
      cpm,
      comision_pct: comision,
      pago_neto: comision != null ? +(cpm * (1 - comision / 100)).toFixed(4) : null,
      presupuesto_total: total,
      presupuesto_restante: restante,
      pct_restante: total ? +(restante / total * 100).toFixed(1) : null,
      participantes: numero(f.participantes),
      nicho: f.nicho || null,
      redes: lista(f.redes),
      minimo_vistas: numero(f.minimo_vistas),
      tope_por_clip: numero(f.tope_por_clip),
      publicada: fecha(f.publicada),
      revisada: fecha(f.revisada),
      requisitos: f.requisitos || f.notas || null,
    });
  }
  salida.sort((a, b) => (b.presupuesto_restante ?? -1) - (a.presupuesto_restante ?? -1));
  return salida;
}

// ---------- ejecución ----------

const config = JSON.parse(await readFile(path.join(RAIZ, 'config.json'), 'utf8'));
const token = (process.env.AIRTABLE_TOKEN || '').trim();
let filasCamp, filasPlat;

if (token && config.airtable_base) {
  [filasCamp, filasPlat] = await Promise.all([
    leerAirtable(config.airtable_base, 'Campañas', token),
    leerAirtable(config.airtable_base, 'Plataformas', token),
  ]);
  console.log(`Airtable: ${filasCamp.length} filas en Campañas, ${filasPlat.length} en Plataformas`);
} else {
  avisos.push('Sin AIRTABLE_TOKEN: se publican los datos de ejemplo');
  [filasCamp, filasPlat] = await Promise.all([
    readFile(path.join(RAIZ, 'datos-ejemplo', 'campanas.csv'), 'utf8').then(parsearCSV),
    readFile(path.join(RAIZ, 'datos-ejemplo', 'plataformas.csv'), 'utf8').then(parsearCSV),
  ]);
}

const plataformas = prepararPlataformas(filasPlat);
const campanas = prepararCampanas(filasCamp, plataformas);

if (existsSync(SALIDA)) await rm(SALIDA, { recursive: true });
await mkdir(SALIDA, { recursive: true });
await cp(path.join(RAIZ, 'sitio'), SALIDA, { recursive: true });

await writeFile(path.join(SALIDA, 'campanas.json'), JSON.stringify({
  generado: new Date().toISOString(),
  ejemplo: !token,
  campanas,
  plataformas: Object.values(plataformas),
}, null, 1));

// Configuración pública para el navegador (sin secretos)
await writeFile(path.join(SALIDA, 'config.js'), `window.FILON = ${JSON.stringify({
  posthogKey: config.posthog_key || '',
  posthogHost: config.posthog_host || 'https://us.i.posthog.com',
  formularioUrl: esURL(config.formulario_url) ? config.formulario_url : '',
})};\n`);

for (const a of avisos) console.log(`AVISO  ${a}`);
console.log(`OK  ${campanas.length} campañas activas publicadas en _site/`);
