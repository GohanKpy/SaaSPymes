import { ConflictException, Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@pymes/db';
import {
  computeRucDv,
  normalizarRuc,
  type Env,
  type RucLookupView,
  type RucPadronRunView,
  type RucPadronSettingsPut,
  type RucPadronSettingsView,
} from '@pymes/shared';

import { MailerService } from '../common/mailer.service';
import { unzipEntries } from '../common/unzip';
import { ENV } from '../env.module';
import { AppPrisma } from '../prisma/app-prisma.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';
import { enlacesDelPadron, parsearPadron, type PadronRow } from './ruc-padron-parser';
import { PADRON_TZ, debeCorrer, proximaCorrida, type PadronSchedule } from './ruc-padron-schedule';

const SETTING_KEY = 'ruc_padron';
/** Pagina publica de la DNIT con los 10 zips (los ids de documento cambian; se leen del HTML). */
const DEFAULT_PAGE_URL = 'https://www.dnit.gov.py/web/portal-institucional/listado-de-ruc-con-sus-equivalencias';
/**
 * Carpeta documental "plana" de la DNIT (verificada 2026-09): respaldo si la
 * pagina no se puede leer o no trae los 10 enlaces.
 */
const DEFAULT_FALLBACK_BASE = 'https://www.dnit.gov.py/documents/20123/3434104';
/** La DNIT publica los dias 1-2 de cada mes: el 5 a las 03:00 da margen (misma cadencia que Unbox). */
const DEFAULT_DAY_OF_MONTH = 5;
const DEFAULT_HOUR = 3;
/**
 * Un archivo real trae ~200.000 contribuyentes. Menos que esto = archivo
 * truncado o formato cambiado: se aborta ANTES de tocar la tabla.
 */
const MIN_ROWS_PER_FILE = 50_000;
const CACHE_TTL_MS = 30_000;
/** Cadencia con la que el cron mira si toca descargar. */
const CHECK_INTERVAL_MS = 10 * 60_000;
const STARTUP_DELAY_MS = 90_000;
/** Filas por INSERT ... ON CONFLICT (5 arrays de este largo por consulta). */
const BATCH = 5000;
const FETCH_TIMEOUT_MS = 180_000;
/** Una corrida 'running' mas vieja que esto se considera muerta (proceso caido). */
const STALE_RUN_MS = 3 * 3600_000;
const RUNS_SHOWN = 10;
const USER_AGENT = 'PyMEs-SaaS/1.0 (padron RUC)';

interface PadronPublic {
  enabled?: boolean;
  page_url?: string;
  day_of_month?: number;
  hour?: number;
}

interface PadronConfig extends PadronSchedule {
  enabled: boolean;
  pageUrl: string;
}

type RunRow = {
  id: bigint;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  triggeredBy: string;
  filesOk: number;
  rowsRead: number;
  rowsChanged: number;
  error: string | null;
};

/**
 * Padron RUC de la DNIT (ADR 0012, pedido de Johan 2026-09-08): un cron
 * in-process (mismo patron que la sync de Google Calendar) descarga a diario
 * los 10 zips del listado publico de contribuyentes y los vuelca en
 * control.ruc_contribuyentes. Los formularios de clientes y facturas
 * consultan ese padron al tipear un RUC y completan razon social y DV.
 * Config y estado desde el portal admin; sin registro rige el default.
 */
@Injectable()
export class RucPadronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PadronRUC');
  private timer: NodeJS.Timeout | null = null;
  private startupTimer: NodeJS.Timeout | null = null;
  private cache: { at: number; config: PadronConfig } | null = null;
  private running = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly appDb: AppPrisma,
    private readonly platformDb: PlatformPrisma,
    private readonly mailer: MailerService,
  ) {}

  onModuleInit(): void {
    // En tests no se descarga nada: el padron es dato externo.
    if (this.env.NODE_ENV === 'test') return;
    this.startupTimer = setTimeout(() => void this.check('startup'), STARTUP_DELAY_MS);
    this.timer = setInterval(() => void this.check('cron'), CHECK_INTERVAL_MS);
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimer) clearTimeout(this.startupTimer);
  }

  // ------------------------------------------------------------ config

  async getConfig(): Promise<PadronConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.config;
    const row = await this.platformDb.client.platformSetting.findUnique({ where: { key: SETTING_KEY } });
    const pub = (row?.publicConfig ?? {}) as PadronPublic;
    const config: PadronConfig = {
      enabled: pub.enabled ?? true,
      pageUrl: pub.page_url || DEFAULT_PAGE_URL,
      dayOfMonth: pub.day_of_month ?? DEFAULT_DAY_OF_MONTH,
      hour: pub.hour ?? DEFAULT_HOUR,
    };
    this.cache = { at: Date.now(), config };
    return config;
  }

  async view(): Promise<RucPadronSettingsView> {
    const config = await this.getConfig();
    const [contribuyentes, runs, lastOk] = await Promise.all([
      this.platformDb.client.rucContribuyente.count(),
      this.platformDb.client.rucPadronRun.findMany({ orderBy: { startedAt: 'desc' }, take: RUNS_SHOWN }),
      this.platformDb.client.rucPadronRun.findFirst({ where: { status: 'ok' }, orderBy: { finishedAt: 'desc' } }),
    ]);
    const lastOkAt = lastOk?.finishedAt ?? null;
    const nextRunAt = config.enabled ? proximaCorrida(new Date(), lastOkAt, config, contribuyentes) : null;
    return {
      enabled: config.enabled,
      page_url: config.pageUrl,
      page_url_default: DEFAULT_PAGE_URL,
      day_of_month: config.dayOfMonth,
      hour: config.hour,
      timezone: PADRON_TZ,
      contribuyentes,
      last_ok_at: lastOkAt?.toISOString() ?? null,
      next_run_at: nextRunAt?.toISOString() ?? null,
      running: this.running || runs.some((r) => r.status === 'running' && Date.now() - r.startedAt.getTime() < STALE_RUN_MS),
      runs: runs.map(runView),
    };
  }

  async save(dto: RucPadronSettingsPut, actorId: string, ip: string): Promise<RucPadronSettingsView> {
    const publicConfig = JSON.parse(
      JSON.stringify({ enabled: dto.enabled, page_url: dto.page_url || undefined, day_of_month: dto.day_of_month, hour: dto.hour } satisfies PadronPublic),
    ) as Prisma.InputJsonValue;
    await this.platformDb.client.platformSetting.upsert({
      where: { key: SETTING_KEY },
      update: { publicConfig, updatedBy: actorId },
      create: { key: SETTING_KEY, publicConfig, updatedBy: actorId },
    });
    await this.platformDb.client.platformAuditLog.create({
      data: { actorId, action: 'settings.ruc_padron.update', entity: 'platform_settings', ip, detail: publicConfig },
    });
    this.cache = null;
    return this.view();
  }

  // ------------------------------------------------------------ consulta

  /** Busca un RUC tipeado en el padron. Si no esta, igual devuelve el DV calculado (modulo 11). */
  async lookup(input: string): Promise<RucLookupView> {
    const ruc = normalizarRuc(input);
    const vacio: RucLookupView = { found: false, ruc, dv: null, razon_social: null, estado: null, ruc_anterior: null, updated_at: null };
    if (!ruc) return vacio;
    const dvCalculado = /^\d+$/.test(ruc) ? String(computeRucDv(ruc)) : null;
    let row: { ruc: string; dv: string; razonSocial: string; estado: string; rucAnterior: string | null; updatedAt: Date } | null = null;
    try {
      row = await this.appDb.client.rucContribuyente.findUnique({ where: { ruc } });
    } catch (err) {
      // Lectura degradada: un problema con el padron no puede romper el formulario.
      this.logger.warn(`lookup fallo: ${(err as Error).message}`);
    }
    if (!row) return { ...vacio, dv: dvCalculado };
    return {
      found: true,
      ruc: row.ruc,
      dv: row.dv,
      razon_social: row.razonSocial,
      estado: row.estado,
      ruc_anterior: row.rucAnterior,
      updated_at: row.updatedAt.toISOString(),
    };
  }

  // ------------------------------------------------------------ descarga

  /** Disparo manual desde el panel. 409 si ya hay una corrida en curso. */
  async syncNow(actorId: string): Promise<{ started: boolean }> {
    if (this.running) throw new ConflictException({ title: 'Ya hay una descarga del padron en curso' });
    void this.runSync('manual', actorId);
    return { started: true };
  }

  private async check(trigger: 'cron' | 'startup'): Promise<void> {
    try {
      const config = await this.getConfig();
      if (!config.enabled || this.running) return;
      const [lastOk, contribuyentes] = await Promise.all([
        this.platformDb.client.rucPadronRun.findFirst({ where: { status: 'ok' }, orderBy: { finishedAt: 'desc' } }),
        this.platformDb.client.rucContribuyente.count(),
      ]);
      if (!debeCorrer(new Date(), lastOk?.finishedAt ?? null, config, contribuyentes)) return;
      // Otra instancia en curso (o una corrida muerta hace menos de 3 h): esperar.
      const enCurso = await this.platformDb.client.rucPadronRun.findFirst({
        where: { status: 'running', startedAt: { gt: new Date(Date.now() - STALE_RUN_MS) } },
      });
      if (enCurso) return;
      await this.runSync(trigger, null);
    } catch (err) {
      this.logger.warn(`check fallo: ${(err as Error).message}`);
    }
  }

  private async runSync(triggeredBy: 'cron' | 'manual' | 'startup', actorId: string | null): Promise<void> {
    if (this.running) return;
    this.running = true;
    const run = await this.platformDb.client.rucPadronRun.create({ data: { triggeredBy, actorId } });
    const t0 = Date.now();
    let filesOk = 0;
    let rowsRead = 0;
    let rowsChanged = 0;
    try {
      const config = await this.getConfig();
      const enlaces = await this.descubrirEnlaces(config.pageUrl);
      for (let digit = 0; digit <= 9; digit++) {
        const url = enlaces.get(digit);
        if (!url) throw new Error(`la pagina de la DNIT no trae el enlace ruc${digit}.zip`);
        const { rows, skipped } = await this.descargarArchivo(url, digit);
        if (rows.length < MIN_ROWS_PER_FILE) {
          throw new Error(`ruc${digit}.zip trae solo ${rows.length} contribuyentes (se esperan ~200.000): archivo truncado o formato cambiado, no se toca el padron`);
        }
        rowsRead += rows.length;
        rowsChanged += await this.volcar(rows);
        filesOk++;
        await this.platformDb.client.rucPadronRun.update({ where: { id: run.id }, data: { filesOk, rowsRead, rowsChanged } });
        this.logger.log(`ruc${digit}.zip: ${rows.length} contribuyentes (${skipped} lineas ignoradas), acumulado ${rowsChanged} cambios`);
      }
      await this.platformDb.client.rucPadronRun.update({
        where: { id: run.id },
        data: { status: 'ok', finishedAt: new Date(), filesOk, rowsRead, rowsChanged },
      });
      this.logger.log(`padron actualizado: ${rowsRead} contribuyentes leidos, ${rowsChanged} filas cambiadas en ${Math.round((Date.now() - t0) / 1000)} s`);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      this.logger.error(`descarga del padron fallo (${filesOk}/10 archivos): ${message}`);
      await this.platformDb.client.rucPadronRun
        .update({ where: { id: run.id }, data: { status: 'error', finishedAt: new Date(), filesOk, rowsRead, rowsChanged, error: message.slice(0, 2000) } })
        .catch(() => undefined);
      await this.avisarFallo(message, filesOk).catch((e: Error) => this.logger.warn(`tampoco se pudo avisar por correo: ${e.message}`));
    } finally {
      this.running = false;
    }
  }

  private async fetchBuffer(url: string): Promise<Buffer> {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), redirect: 'follow' });
    if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }

  private async descubrirEnlaces(pageUrl: string): Promise<Map<number, string>> {
    // Si la URL configurada ya apunta a un zip (espejo propio con ruc{N}.zip), se derivan los 10.
    if (/ruc\d\.zip/i.test(pageUrl)) {
      return new Map(Array.from({ length: 10 }, (_, d) => [d, pageUrl.replace(/ruc\d\.zip/i, `ruc${d}.zip`)]));
    }
    // Los enlaces del portal llevan un id que cambia con cada publicacion: se
    // leen de la pagina; si falta alguno se completa con la carpeta documental.
    let enlaces = new Map<number, string>();
    try {
      const html = (await this.fetchBuffer(pageUrl)).toString('utf8');
      enlaces = enlacesDelPadron(html, pageUrl);
    } catch (err) {
      this.logger.warn(`no se pudo leer la pagina de la DNIT (${(err as Error).message}); se usa la carpeta documental de respaldo`);
    }
    for (let d = 0; d <= 9; d++) {
      if (!enlaces.has(d)) enlaces.set(d, `${DEFAULT_FALLBACK_BASE}/ruc${d}.zip`);
    }
    return enlaces;
  }

  /** Aviso a los padmin activos: el padron vigente queda intacto, hay que reintentar desde el panel. */
  private async avisarFallo(error: string, filesOk: number): Promise<void> {
    const admins = await this.platformDb.client.platformUser.findMany({ where: { role: 'admin', isActive: true }, select: { email: true } });
    const to = admins.map((a) => a.email).filter(Boolean);
    if (to.length === 0) {
      this.logger.warn('fallo del padron sin destinatarios de alerta (no hay padmin activos)');
      return;
    }
    const fecha = new Date().toLocaleString('es-PY', { timeZone: PADRON_TZ, dateStyle: 'full', timeStyle: 'short' });
    await this.mailer.send({
      to: to.join(', '),
      subject: 'Falló la actualización del padrón RUC de la DNIT',
      text: [
        `La descarga programada del padrón de contribuyentes de la DNIT falló el ${fecha} (${filesOk}/10 archivos procesados).`,
        '',
        `Error: ${error.slice(0, 500)}`,
        '',
        'El sistema sigue funcionando con el padrón anterior: el autocompletado de RUC responde, solo que sin las altas y cambios más recientes.',
        'Para reintentar: portal admin → Configuración → Padrón RUC (DNIT) → "Descargar ahora".',
      ].join('\n'),
    });
    this.logger.log(`aviso de fallo enviado a ${to.length} padmin`);
  }

  private async descargarArchivo(url: string, digit: number): Promise<ReturnType<typeof parsearPadron>> {
    const zip = await this.fetchBuffer(url);
    const entries = unzipEntries(zip);
    const txt = entries.find((e) => /\.txt$/i.test(e.name)) ?? entries[0];
    if (!txt) throw new Error(`ruc${digit}.zip vino vacio`);
    const parsed = parsearPadron(txt.data.toString('utf8'));
    if (parsed.rows.length === 0) throw new Error(`ruc${digit}.zip no trae contribuyentes (formato cambiado?)`);
    return parsed;
  }

  /** Upsert por lotes; solo toca las filas que realmente cambiaron. Devuelve filas insertadas/actualizadas. */
  private async volcar(rows: PadronRow[]): Promise<number> {
    let changed = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const lote = rows.slice(i, i + BATCH);
      const rucs = lote.map((r) => r.ruc);
      const dvs = lote.map((r) => r.dv);
      const nombres = lote.map((r) => r.razonSocial);
      const anteriores = lote.map((r) => r.rucAnterior ?? '');
      const estados = lote.map((r) => r.estado);
      changed += await this.platformDb.client.$executeRaw`
        INSERT INTO control.ruc_contribuyentes (ruc, dv, razon_social, ruc_anterior, estado, updated_at)
        SELECT t.ruc, t.dv, t.razon_social, NULLIF(t.ruc_anterior, ''), t.estado, now()
        FROM unnest(${rucs}::text[], ${dvs}::text[], ${nombres}::text[], ${anteriores}::text[], ${estados}::text[])
          AS t(ruc, dv, razon_social, ruc_anterior, estado)
        ON CONFLICT (ruc) DO UPDATE
          SET dv = EXCLUDED.dv, razon_social = EXCLUDED.razon_social, ruc_anterior = EXCLUDED.ruc_anterior,
              estado = EXCLUDED.estado, updated_at = now()
          WHERE (control.ruc_contribuyentes.dv, control.ruc_contribuyentes.razon_social,
                 control.ruc_contribuyentes.ruc_anterior, control.ruc_contribuyentes.estado)
                IS DISTINCT FROM (EXCLUDED.dv, EXCLUDED.razon_social, EXCLUDED.ruc_anterior, EXCLUDED.estado)`;
    }
    return changed;
  }
}

function runView(r: RunRow): RucPadronRunView {
  return {
    id: String(r.id),
    started_at: r.startedAt.toISOString(),
    finished_at: r.finishedAt?.toISOString() ?? null,
    status: r.status as RucPadronRunView['status'],
    triggered_by: r.triggeredBy as RucPadronRunView['triggered_by'],
    files_ok: r.filesOk,
    rows_read: r.rowsRead,
    rows_changed: r.rowsChanged,
    error: r.error,
  };
}
