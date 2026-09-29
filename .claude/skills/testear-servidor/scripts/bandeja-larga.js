// La bandeja abierta y quieta 18 min: cada reconexion del stream y si al final
// un mensaje nuevo de un cliente aparece SOLO (sin recargar la pagina).
const { chromium } = require('playwright');
const fs = require('fs');
// Lee el resultado de la ultima corrida de bateria-api.py (QA_SALIDA, fuera del repo).
const SALIDA = process.env.QA_SALIDA || require('path').join(require('os').homedir(), '.cache/pymes-qa');
const g = fs.readdirSync(SALIDA).filter((f) => f.startsWith('qa_resultado_')).sort();
const R = JSON.parse(fs.readFileSync(SALIDA + '/' + g[g.length - 1]));
const WEB = (process.env.QA_WEB || 'https://client.inicia.com.py').replace(/\/$/, '');
const WA = `dev-qa-srv-${R.ts}`;
(async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const t0 = Date.now(); const seg = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(5);
  p.on('response', (r) => { if (r.url().includes('/conversations/stream')) console.log(`${seg()}s  stream -> HTTP ${r.status()}`); });
  p.on('requestfailed', (r) => { if (r.url().includes('/conversations/stream')) console.log(`${seg()}s  stream cortado (${r.failure()?.errorText})`); });
  await p.goto(WEB + '/login', { waitUntil: 'networkidle' });
  await p.fill('input[type=email]', R.root); await p.fill('input[type=password]', R.root_pass);
  await p.click('button:has-text("Entrar")'); await p.waitForURL('**/app**');
  await p.goto(WEB + '/app/inbox', { waitUntil: 'networkidle' });
  console.log(`${seg()}s  bandeja abierta; queda quieta 18 minutos`);
  await p.waitForTimeout(18 * 60 * 1000);
  const nombre = `Cliente Tardio ${Date.now() % 100000}`;
  const tel = `+59598177${String(Date.now()).slice(-4)}`;
  const r = await p.request.post(WEB + '/chat/send', { data: { phone_number_id: WA, from_phone: tel, from_name: nombre, body: 'Hola, escribo despues de 18 minutos' } });
  console.log(`${seg()}s  un cliente escribe por el chat de prueba -> HTTP ${r.status()} (${nombre})`);
  let visto = false;
  for (let i = 0; i < 20 && !visto; i++) { await p.waitForTimeout(1500); visto = (await p.locator('body').innerText()).includes(tel) || (await p.locator('body').innerText()).includes(nombre); }
  console.log(`${seg()}s  RESULTADO: el mensaje nuevo ${visto ? 'APARECIO SOLO en la bandeja (en vivo OK)' : 'NO aparecio sin recargar (en vivo MUERTO)'}`);
  await p.screenshot({ path: __dirname + '/shots/bandeja_18min.png' });
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(1500);
  const trasRecargar = (await p.locator('body').innerText()).includes(tel) || (await p.locator('body').innerText()).includes(nombre);
  console.log(`${seg()}s  tras recargar la pagina: ${trasRecargar ? 'el mensaje esta' : 'tampoco esta'}`);
  await b.close();
})().catch((e) => { console.error('FALLO:', e.message); process.exit(1); });
