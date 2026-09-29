// Recorrido de TODAS las pantallas de los dos portales en un navegador real:
// errores de JS/consola, llamadas a la API fallidas, pantallas de error,
// cada pestaña (role=tab) y una pasada en tamaño celular (desborde horizontal).
const { chromium } = require('playwright');
const fs = require('fs');
// Lee el resultado de la ultima corrida de bateria-api.py (QA_SALIDA, fuera del repo).
const SALIDA = process.env.QA_SALIDA || require('path').join(require('os').homedir(), '.cache/pymes-qa');
const glob = fs.readdirSync(SALIDA).filter((f) => f.startsWith('qa_resultado_')).sort();
const R = JSON.parse(fs.readFileSync(SALIDA + '/' + glob[glob.length - 1]));
const OUT = SALIDA + '/capturas';
const PADMIN_EMAIL = process.env.QA_PADMIN_EMAIL;
const PADMIN_PASS = process.env.QA_PADMIN_PASS;
if (!PADMIN_EMAIL || !PADMIN_PASS) throw new Error('Faltan QA_PADMIN_EMAIL / QA_PADMIN_PASS');
fs.mkdirSync(OUT, { recursive: true });

const CLIENTE = [
  '/app', '/app/inbox', '/app/schedule', '/app/tasks', '/app/customers', `/app/customers/${R.ids.CA}`,
  '/app/catalog', '/app/invoices', '/app/cobros', '/app/employees', '/app/team', '/app/settings',
  '/app/settings/empresa', '/app/settings/horarios', '/app/settings/whatsapp', '/app/settings/bot',
  '/app/settings/calendario', '/app/settings/campos', '/app/settings/facturacion', '/app/settings/cuenta', '/chat',
];
const ADMIN = [
  '/platform', `/platform/tenants/${R.tenant_id}`, '/platform/plans', '/platform/audit', '/platform/team',
  '/platform/profile', '/platform/settings', '/platform/settings/bot', '/platform/settings/google',
  '/platform/settings/mail', '/platform/settings/ruc-padron', '/platform/settings/seguridad',
];
const TEXTO_ERROR = /Application error|Unhandled Runtime Error|Algo sali[oó] mal|Internal Server Error|This page could not be found/i;
const resultados = [];

async function sesion(browser, base, loginPath, email, pass, viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'es-PY' });
  const page = await ctx.newPage();
  const ev = { consola: [], js: [], api: [] };
  page.on('console', (m) => { if (m.type() === 'error') ev.consola.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => ev.js.push(e.message.slice(0, 200)));
  page.on('response', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.status() >= 400) ev.api.push(`${r.status()} ${r.request().method()} ${u.pathname}`);
  });
  await page.goto(base + loginPath, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', pass);
  await page.click('button:has-text("Entrar")');
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
  await page.waitForTimeout(1500);
  return { ctx, page, ev };
}

function tomar(ev) {
  const r = { consola: ev.consola.splice(0), js: ev.js.splice(0), api: ev.api.splice(0) };
  return r;
}

async function visitar(s, base, ruta, portal, movil) {
  const { page, ev } = s;
  tomar(ev);
  let estado = 'ok';
  try {
    const resp = await page.goto(base + ruta, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1200);
    if (resp && resp.status() >= 400) estado = `HTTP ${resp.status()}`;
  } catch (e) { estado = 'no cargo: ' + e.message.slice(0, 80); }
  const body = await page.locator('body').innerText().catch(() => '');
  const errTexto = TEXTO_ERROR.test(body) ? (body.match(TEXTO_ERROR) || [''])[0] : null;
  const nombre = (portal + ruta).replace(/[^a-z0-9]+/gi, '_').slice(0, 80) + (movil ? '_movil' : '');
  let desborde = null;
  if (movil) {
    desborde = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  } else {
    await page.screenshot({ path: `${OUT}/${nombre}.png` });
  }
  const pestanas = [];
  if (!movil) {
    const tabs = page.locator('[role=tab]');
    const n = await tabs.count();
    for (let i = 0; i < n; i++) {
      const etiqueta = (await tabs.nth(i).innerText()).trim().split('\n')[0];
      tomar(ev);
      await tabs.nth(i).click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(900);
      const b2 = await page.locator('body').innerText().catch(() => '');
      await page.screenshot({ path: `${OUT}/${nombre}__${etiqueta.replace(/[^a-z0-9]+/gi, '_')}.png` });
      pestanas.push({ pestana: etiqueta, errorPantalla: TEXTO_ERROR.test(b2), ...tomar(ev) });
    }
  }
  const r = { portal, ruta, movil: !!movil, estado, errorPantalla: errTexto, desborde, ...tomar(ev), pestanas };
  resultados.push(r);
  const problemas = [r.estado !== 'ok' && r.estado, r.errorPantalla, r.js.length && `JS: ${r.js[0]}`, r.consola.length && `consola: ${r.consola[0]}`,
    r.api.length && `API: ${r.api.join(', ')}`, movil && desborde > 2 && `desborde horizontal ${desborde}px`,
    ...pestanas.filter((p) => p.errorPantalla || p.js.length || p.api.length || p.consola.length)
      .map((p) => `pestaña "${p.pestana}": ${[p.js[0], p.api.join(', '), p.consola[0]].filter(Boolean).join(' | ')}`)].filter(Boolean);
  console.log(`${problemas.length ? 'REVISAR' : 'ok     '} [${portal}${movil ? ' movil' : ''}] ${ruta}${pestanas.length ? ` (${pestanas.length} pestañas)` : ''}${problemas.length ? '  -> ' + problemas.join(' || ') : ''}`);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const C = (process.env.QA_WEB || 'https://client.inicia.com.py').replace(/\/$/, '');
  const A = (process.env.QA_ADMIN_WEB || 'https://admin.inicia.com.py').replace(/\/$/, '');
  const escritorio = { width: 1440, height: 900 };
  const telefono = { width: 390, height: 844 };

  const sc = await sesion(browser, C, '/login', R.root, R.root_pass, escritorio);
  for (const r of CLIENTE) await visitar(sc, C, r, 'clientes');
  const sa = await sesion(browser, A, '/platform/login', PADMIN_EMAIL, PADMIN_PASS, escritorio);
  for (const r of ADMIN) await visitar(sa, A, r, 'admin');

  const mc = await sesion(browser, C, '/login', R.root, R.root_pass, telefono);
  for (const r of ['/app', '/app/schedule', '/app/customers', '/app/catalog', '/app/invoices', '/app/inbox', '/app/settings']) await visitar(mc, C, r, 'clientes', true);
  const ma = await sesion(browser, A, '/platform/login', PADMIN_EMAIL, PADMIN_PASS, telefono);
  for (const r of ['/platform', '/platform/plans', '/platform/settings']) await visitar(ma, A, r, 'admin', true);

  fs.writeFileSync(SALIDA + '/recorrido_resultado.json', JSON.stringify(resultados, null, 1));
  const conProblemas = resultados.filter((r) => r.estado !== 'ok' || r.errorPantalla || r.js.length || r.api.length || r.consola.length || (r.movil && r.desborde > 2) ||
    r.pestanas.some((p) => p.errorPantalla || p.js.length || p.api.length || p.consola.length));
  const totalPestanas = resultados.reduce((s, r) => s + r.pestanas.length, 0);
  console.log(`\n##### ${resultados.length} pantallas (${resultados.filter((r) => !r.movil).length} escritorio + ${resultados.filter((r) => r.movil).length} celular) y ${totalPestanas} pestañas | con algo para revisar: ${conProblemas.length}`);
  await browser.close();
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
