// Filón · listado, filtros, orden y medición (Cortes 1 y 2)
(() => {
  const $ = id => document.getElementById(id);
  const CFG = window.FILON || {};
  const lista = $('lista');
  const titular = $('titular');
  const formFiltros = $('filtros');
  const DIA = 86400000;

  // ---------- medición (PostHog, solo si hay clave en config.json) ----------

  let colaEventos = [];
  function cargarAnalitica() {
    if (!CFG.posthogKey) { colaEventos = null; return; }
    const host = CFG.posthogHost || 'https://us.i.posthog.com';
    const s = document.createElement('script');
    s.async = true;
    s.src = host.replace('.i.posthog.com', '-assets.i.posthog.com') + '/static/array.js';
    s.onload = () => {
      if (!window.posthog?.init) return;
      window.posthog.init(CFG.posthogKey, {
        api_host: host,
        autocapture: false,
        capture_pageview: true,
        person_profiles: 'identified_only',
      });
      (colaEventos || []).forEach(([e, p]) => window.posthog.capture(e, p));
      colaEventos = null;
    };
    document.head.append(s);
  }
  function medir(evento, props = {}) {
    if (colaEventos) colaEventos.push([evento, props]);
    else window.posthog?.capture?.(evento, props);
  }

  // ---------- formato ----------

  const nf = dec => new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: 'always',
  });

  function dinero(n, moneda, dec = 0) {
    const s = nf(dec).format(n);
    if (moneda === 'EUR') return `${s} €`;
    if (moneda === 'USDT') return `${s} USDT`;
    return `$${s}`;
  }

  function diasDesde(iso) {
    if (!iso) return null;
    const [a, m, d] = iso.split('-').map(Number);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    return Math.round((hoy - new Date(a, m - 1, d)) / DIA);
  }

  function haceDias(iso) {
    const dias = diasDesde(iso);
    if (dias == null) return null;
    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    return `hace ${dias} días`;
  }

  const sinTildes = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const pagoDe = c => c.pago_neto ?? c.cpm;
  const capitalizar = s => s ? s[0].toUpperCase() + s.slice(1) : s;

  // ---------- fila de campaña ----------

  function dato(dl, etiqueta, valor, ancho = false) {
    if (valor == null || valor === '') return;
    const div = document.createElement('div');
    if (ancho) div.className = 'ancho';
    const dt = document.createElement('dt'); dt.textContent = etiqueta;
    const dd = document.createElement('dd'); dd.textContent = valor;
    div.append(dt, dd);
    dl.append(div);
  }

  function pintarFilon(c, tpl) {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = c.id;
    li.querySelector('.filon-nombre').textContent = c.nombre;
    li.querySelector('.filon-origen').textContent = c.anfitrion
      ? `${c.anfitrion} en ${c.plataforma}` : `En ${c.plataforma}`;

    li.querySelector('.pago-cifra').textContent = dinero(pagoDe(c), c.moneda, 2);
    li.querySelector('.pago-nota').textContent = c.pago_neto != null
      ? `por 1.000 vistas, sin el ${nf(0).format(c.comision_pct)} % de comisión`
      : 'por 1.000 vistas, comisión sin confirmar';

    const veta = li.querySelector('.veta');
    const bote = li.querySelector('.bote-texto');
    if (c.presupuesto_total != null) {
      li.querySelector('.veta-relleno').style.setProperty('--pct', `${Math.max(c.pct_restante, 1.5)}%`);
      veta.setAttribute('aria-label', `Queda el ${nf(0).format(c.pct_restante)} % del presupuesto`);
      const quedan = document.createElement('strong');
      quedan.textContent = dinero(c.presupuesto_restante, c.moneda);
      bote.append('Quedan ', quedan, ` de ${dinero(c.presupuesto_total, c.moneda)}`);
      if (c.pct_restante < 20) {
        li.classList.add('poco');
        const alerta = document.createElement('span');
        alerta.className = 'bote-alerta';
        alerta.textContent = '. Se está agotando';
        bote.append(alerta);
      }
    } else {
      veta.hidden = true;
      bote.textContent = 'Presupuesto sin dato';
    }

    const dl = li.querySelector('.filon-datos');
    dato(dl, 'Nicho', c.nicho);
    dato(dl, 'Redes', c.redes.join(', '));
    const cond = [];
    if (c.minimo_vistas) cond.push(`mínimo ${nf(0).format(c.minimo_vistas)} vistas`);
    if (c.tope_por_clip) cond.push(`tope ${dinero(c.tope_por_clip, c.moneda)} por clip`);
    if (cond.length) dato(dl, 'Condiciones', capitalizar(cond.join(', ')));
    if (c.participantes) dato(dl, 'Participantes', nf(0).format(c.participantes));
    const pub = haceDias(c.publicada), rev = haceDias(c.revisada);
    if (pub || rev) dato(dl, 'Fechas', capitalizar([pub && `publicada ${pub}`, rev && `revisada ${rev}`].filter(Boolean).join(', ')));
    dato(dl, 'Requisitos', c.requisitos, true);

    const a = li.querySelector('.filon-unirse');
    a.href = c.enlace;
    a.textContent = `Unirse en ${c.plataforma}`;
    a.setAttribute('aria-label', `Unirse a ${c.nombre} en ${c.plataforma} (se abre en otra pestaña)`);
    return li;
  }

  // ---------- titular (todo el mercado, sin filtros) ----------

  function pintarTitular(campanas) {
    const n = campanas.length;
    if (!n) { titular.textContent = 'Ahora mismo no hay campañas activas.'; return; }
    let usd = 0, eur = 0;
    for (const c of campanas) {
      if (c.presupuesto_restante == null) continue;
      if (c.moneda === 'EUR') eur += c.presupuesto_restante; else usd += c.presupuesto_restante;
    }
    const partes = [];
    if (usd > 0) partes.push(dinero(usd, 'USD'));
    if (eur > 0) partes.push(dinero(eur, 'EUR'));
    const campTxt = `${n} ${n === 1 ? 'campaña' : 'campañas'} de clipping en español`;
    titular.textContent = partes.length
      ? `Hoy quedan ${partes.join(' y ')} por repartir en ${campTxt}.`
      : `Hoy hay ${campTxt} abiertas.`;
  }

  // ---------- filtros y orden ----------

  const estado = { q: '', plataforma: '', red: '', nicho: '', pago: '', orden: 'bote', nuevas: false };

  function leerURL() {
    const p = new URLSearchParams(location.search);
    for (const k of Object.keys(estado)) {
      if (!p.has(k)) continue;
      estado[k] = k === 'nuevas' ? p.get(k) === '1' : p.get(k);
    }
  }

  function escribirURL() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(estado)) {
      if (k === 'orden' && v === 'bote') continue;
      if (v === '' || v === false) continue;
      p.set(k, v === true ? '1' : v);
    }
    const qs = p.toString();
    history.replaceState(null, '', qs ? `?${qs}` : location.pathname);
  }

  function llenarSelect(sel, valores) {
    for (const v of valores) {
      const o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.append(o);
    }
  }

  function prepararFiltros(campanas) {
    const unicos = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
    llenarSelect($('f-plataforma'), unicos(campanas.map(c => c.plataforma)));
    llenarSelect($('f-red'), unicos(campanas.flatMap(c => c.redes)));
    llenarSelect($('f-nicho'), unicos(campanas.map(c => c.nicho)));

    $('f-buscar').value = estado.q;
    $('f-plataforma').value = estado.plataforma;
    $('f-red').value = estado.red;
    $('f-nicho').value = estado.nicho;
    $('f-pago').value = estado.pago;
    $('f-orden').value = estado.orden;
    $('f-nuevas').checked = estado.nuevas;
    formFiltros.hidden = false;
    if (filtrosDelPanel()) abrirPanel(true);
  }

  const filtrosDelPanel = () => [estado.plataforma, estado.red, estado.nicho, estado.pago, estado.nuevas].filter(Boolean).length;

  function abrirPanel(abrir) {
    $('panel-filtros').classList.toggle('abierto', abrir);
    $('boton-filtros').setAttribute('aria-expanded', String(abrir));
  }

  function actualizarBoton() {
    const n = filtrosDelPanel();
    $('boton-filtros').textContent = n ? `Filtros (${n})` : 'Filtros';
  }

  function filtrar(campanas) {
    const q = sinTildes(estado.q.trim());
    const pagoMin = Number(estado.pago) || 0;
    const res = campanas.filter(c => {
      if (estado.plataforma && c.plataforma !== estado.plataforma) return false;
      if (estado.red && !c.redes.includes(estado.red)) return false;
      if (estado.nicho && c.nicho !== estado.nicho) return false;
      if (pagoMin && pagoDe(c) < pagoMin) return false;
      if (estado.nuevas) { const d = diasDesde(c.publicada); if (d == null || d > 3) return false; }
      if (q && !sinTildes([c.nombre, c.anfitrion, c.plataforma, c.nicho].join(' ')).includes(q)) return false;
      return true;
    });
    const orden = {
      bote: (a, b) => (b.presupuesto_restante ?? -1) - (a.presupuesto_restante ?? -1),
      pago: (a, b) => pagoDe(b) - pagoDe(a),
      nuevas: (a, b) => (b.publicada || '').localeCompare(a.publicada || ''),
    }[estado.orden] || (() => 0);
    return res.sort(orden);
  }

  const hayFiltros = () => Boolean(estado.q || estado.plataforma || estado.red || estado.nicho || estado.pago || estado.nuevas);

  // ---------- render ----------

  let todas = [];
  const tpl = $('tpl-filon');

  function render() {
    const visibles = filtrar(todas);
    const frag = document.createDocumentFragment();
    visibles.forEach(c => frag.append(pintarFilon(c, tpl)));
    lista.replaceChildren(frag);
    lista.hidden = !visibles.length;
    $('sin-resultados').hidden = visibles.length > 0 || !todas.length;
    $('conteo').textContent = !todas.length ? ''
      : visibles.length === todas.length ? `${todas.length} ${todas.length === 1 ? 'campaña' : 'campañas'}`
      : `Mostrando ${visibles.length} de ${todas.length} campañas`;
    actualizarBoton();
    escribirURL();
    return visibles;
  }

  function enlazarEventos() {
    let tBusqueda;
    $('f-buscar').addEventListener('input', e => {
      estado.q = e.target.value;
      const visibles = render();
      clearTimeout(tBusqueda);
      tBusqueda = setTimeout(() => {
        if (estado.q.trim()) medir('busqueda', { texto: estado.q.trim().slice(0, 60), resultados: visibles.length });
      }, 900);
    });
    const selects = { 'f-plataforma': 'plataforma', 'f-red': 'red', 'f-nicho': 'nicho', 'f-pago': 'pago', 'f-orden': 'orden' };
    for (const [id, clave] of Object.entries(selects)) {
      $(id).addEventListener('change', e => {
        estado[clave] = e.target.value;
        const visibles = render();
        medir(clave === 'orden' ? 'orden' : 'filtro', { filtro: clave, valor: e.target.value, resultados: visibles.length });
      });
    }
    $('f-nuevas').addEventListener('change', e => {
      estado.nuevas = e.target.checked;
      const visibles = render();
      medir('filtro', { filtro: 'nuevas', valor: e.target.checked, resultados: visibles.length });
    });
    formFiltros.addEventListener('submit', e => e.preventDefault());
    $('boton-filtros').addEventListener('click', () => {
      abrirPanel($('boton-filtros').getAttribute('aria-expanded') !== 'true');
    });

    $('quitar-filtros').addEventListener('click', () => {
      Object.assign(estado, { q: '', plataforma: '', red: '', nicho: '', pago: '', nuevas: false });
      prepararFiltrosValores();
      render();
      medir('quitar_filtros');
    });

    lista.addEventListener('click', e => {
      const a = e.target.closest('.filon-unirse');
      if (!a) return;
      const li = a.closest('.filon');
      const c = todas.find(x => x.id === li.dataset.id);
      if (!c) return;
      medir('clic_campana', {
        campana_id: c.id, campana: c.nombre, plataforma: c.plataforma, pago_1000: pagoDe(c), moneda: c.moneda,
        posicion: [...lista.children].indexOf(li) + 1, con_filtros: hayFiltros(),
      });
    });

    $('enlace-formulario')?.addEventListener('click', () => medir('clic_publicar_campana'));
  }

  function prepararFiltrosValores() {
    $('f-buscar').value = estado.q;
    ['plataforma', 'red', 'nicho', 'pago'].forEach(k => { $(`f-${k}`).value = estado[k]; });
    $('f-nuevas').checked = estado.nuevas;
  }

  // ---------- inicio ----------

  async function iniciar() {
    cargarAnalitica();
    if (CFG.formularioUrl) {
      $('enlace-formulario').href = CFG.formularioUrl;
      $('pie-formulario').hidden = false;
    }
    try {
      const res = await fetch('campanas.json', { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status);
      const datos = await res.json();
      todas = datos.campanas || [];

      $('actualizado').textContent = `Actualizado el ${new Intl.DateTimeFormat('es-ES', {
        day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
      }).format(new Date(datos.generado))}`;

      pintarTitular(todas);
      if (!todas.length) {
        lista.hidden = true;
        $('conteo').textContent = 'Las campañas se revisan cada mañana. Vuelve más tarde.';
        return;
      }
      leerURL();
      prepararFiltros(todas);
      enlazarEventos();
      render();
    } catch (e) {
      titular.textContent = 'No se pudieron cargar las campañas.';
      document.querySelector('.bajada').textContent = 'Recarga la página en unos minutos.';
    }
  }

  iniciar();
})();
