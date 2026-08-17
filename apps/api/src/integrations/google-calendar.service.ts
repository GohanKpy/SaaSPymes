import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma } from '@pymes/db';
import type { Env } from '@pymes/shared';

import { CryptoService } from '../common/crypto.service';
import { ENV } from '../env.module';
import { GoogleOauthService } from '../platform/google-oauth.service';
import { AppPrisma } from '../prisma/app-prisma.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';
import { localToUtc } from '../scheduling/appointments.service';

const SWEEP_INTERVAL_MS = 5 * 60_000; // vuelta reciproca: barrido incremental
const STATE_TTL_MS = 10 * 60_000; // validez del state del flujo OAuth
const SYNC_HORIZON_DAYS = 60; // ventana del primer sync completo

interface OauthState {
  tid: string;
  uid: string;
  origin: string;
  exp: number;
  /** Conexion propia de un empleado (fase 3); ausente = la del negocio. */
  eid?: string;
}

interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  extendedProperties?: { private?: Record<string, string> };
}

/** Datos minimos del turno para retirar sus eventos espejo. */
export interface AppointmentEventRefs {
  googleEventId: string | null;
  employeeId: string | null;
  employeeGoogleEventId: string | null;
}

/**
 * Sincronizacion con Google Calendar (ADR 0007 + fase C reciproca; fase 3 del
 * ADR 0009 agrega conexiones POR EMPLEADO ademas de la del negocio).
 * - Ida: cada turno creado/cancelado se refleja en el calendario del tenant
 *   y, si el empleado asignado conecto el suyo, tambien en el del empleado.
 * - Vuelta: barrido incremental con syncToken cada 5 min por CONEXION —
 *   eventos ajenos del calendario del negocio bloquean todo; los del
 *   calendario de un empleado solo lo sacan a el de la franja. Borrar a mano
 *   NUESTRO evento en el calendario del NEGOCIO cancela el turno; borrarlo
 *   del calendario del empleado se ignora (la agenda del negocio manda).
 * Nada de esto bloquea jamas una reserva: los errores solo se loguean.
 */
@Injectable()
export class GoogleCalendarService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('GCal');
  private timer: NodeJS.Timeout | null = null;
  private readonly tokens = new Map<string, { token: string; exp: number }>();

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly appDb: AppPrisma,
    private readonly platformDb: PlatformPrisma,
    private readonly crypto: CryptoService,
    private readonly oauth: GoogleOauthService,
  ) {}

  onModuleInit(): void {
    // Mismo patron que el sweep de conversaciones inactivas: arranque suave
    // y cadencia fija. Sin credenciales conectadas el barrido no hace nada.
    setTimeout(() => void this.sweep(), 45_000);
    this.timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private redirectUri(): string {
    const base = this.env.PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:4301';
    return `${base}/api/v1/integrations/google/callback`;
  }

  private cacheKey(tenantId: string, employeeId: string | null): string {
    return `${tenantId}:${employeeId ?? 'tenant'}`;
  }

  /** URL de autorizacion; state cifrado (tenant + empleado + origen). */
  async authUrl(
    tenantId: string,
    userId: string,
    origin: string,
    employeeId?: string | null,
  ): Promise<string> {
    const config = await this.oauth.getConfig();
    if (!config.clientId || !config.clientSecret) {
      throw new Error('google_oauth_not_configured');
    }
    const state: OauthState = {
      tid: tenantId,
      uid: userId,
      origin,
      exp: Date.now() + STATE_TTL_MS,
      ...(employeeId ? { eid: employeeId } : {}),
    };
    const stateToken = Buffer.from(this.crypto.encryptJson(state)).toString('base64url');
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: this.redirectUri(),
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      prompt: 'consent', // fuerza refresh_token aunque ya haya autorizado antes
      state: stateToken,
    });
    return `${this.env.GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`;
  }

  /** Callback de OAuth: canjea el code y guarda la conexion (negocio o empleado). */
  async connect(stateToken: string, code: string): Promise<{ origin: string; path: string }> {
    const state = this.crypto.decryptJson<OauthState>(Buffer.from(stateToken, 'base64url'));
    if (!state.tid || state.exp < Date.now()) throw new Error('state vencido');
    const employeeId = state.eid ?? null;
    const config = await this.oauth.getConfig();
    if (!config.clientId || !config.clientSecret) throw new Error('google_oauth_not_configured');

    const res = await fetch(this.env.GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: this.redirectUri(),
        grant_type: 'authorization_code',
      }),
    });
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      error?: string;
    };
    if (!res.ok || !data.refresh_token || !data.access_token) {
      throw new Error(`canje de code fallo: ${data.error ?? res.status}`);
    }

    // Email de la cuenta conectada, para mostrarlo en el panel.
    let connectedEmail: string | null = null;
    try {
      const cal = await fetch(`${this.env.GOOGLE_CALENDAR_API_URL}/calendars/primary`, {
        headers: { authorization: `Bearer ${data.access_token}` },
      });
      if (cal.ok) connectedEmail = ((await cal.json()) as { id?: string }).id ?? null;
    } catch {
      // sin email no pasa nada: la conexion sirve igual
    }

    const ctx = { tenantId: state.tid, actorType: 'system' as const };
    const encryptedPayload = this.crypto.encryptJson({ refresh_token: data.refresh_token });
    const publicConfig = {
      status: 'connected',
      calendar_id: 'primary',
      connected_email: connectedEmail,
      sync_token: null,
    };
    await this.appDb.tx(ctx, async (tx) => {
      // La unicidad (tenant, type, employee) es NULLS NOT DISTINCT: con
      // employee_id null el upsert compuesto de Prisma no aplica.
      const existing = await tx.integrationCredential.findFirst({
        where: { type: 'google_calendar', employeeId },
      });
      if (existing) {
        await tx.integrationCredential.update({
          where: { id: existing.id },
          data: {
            encryptedPayload,
            publicConfig: publicConfig as Prisma.InputJsonValue,
            isActive: true,
            updatedBy: state.uid,
          },
        });
      } else {
        await tx.integrationCredential.create({
          data: {
            tenantId: state.tid,
            type: 'google_calendar',
            employeeId,
            encryptedPayload,
            publicConfig: publicConfig as Prisma.InputJsonValue,
            updatedBy: state.uid,
          },
        });
      }
    });
    this.tokens.delete(this.cacheKey(state.tid, employeeId));
    this.logger.log(
      `google calendar conectado tenant=${state.tid} empleado=${employeeId ?? '-'} email=${connectedEmail}`,
    );
    return { origin: state.origin, path: employeeId ? '/app/employees' : '/app/settings' };
  }

  /** Access token vigente de una conexion (refresh en memoria, jamas persistido). */
  private async accessToken(tenantId: string, employeeId: string | null): Promise<string | null> {
    const key = this.cacheKey(tenantId, employeeId);
    const cached = this.tokens.get(key);
    if (cached && cached.exp > Date.now()) return cached.token;

    const ctx = { tenantId, actorType: 'system' as const };
    const row = await this.appDb.tx(ctx, (tx) =>
      tx.integrationCredential.findFirst({
        where: { type: 'google_calendar', employeeId, isActive: true },
      }),
    );
    if (!row) return null;
    const publicConfig = row.publicConfig as { status?: string };
    if (publicConfig.status === 'disconnected') return null;
    const secret = this.crypto.decryptJson<{ refresh_token?: string }>(row.encryptedPayload);
    if (!secret.refresh_token) return null;
    const config = await this.oauth.getConfig();
    if (!config.clientId || !config.clientSecret) return null;

    const res = await fetch(this.env.GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: secret.refresh_token,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    const data = (await res.json()) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !data.access_token) {
      if (data.error === 'invalid_grant') {
        // Revocacion real (ADR 0007): estado disconnected, el panel ofrece
        // "Reconectar". Unico escenario de re-autenticacion.
        await this.setStatus(tenantId, employeeId, 'disconnected');
        this.logger.warn(`google calendar revocado tenant=${tenantId} empleado=${employeeId ?? '-'}`);
      }
      return null;
    }
    const token = data.access_token;
    this.tokens.set(key, { token, exp: Date.now() + ((data.expires_in ?? 3600) - 60) * 1000 });
    return token;
  }

  private async setStatus(
    tenantId: string,
    employeeId: string | null,
    status: 'connected' | 'disconnected',
  ): Promise<void> {
    const ctx = { tenantId, actorType: 'system' as const };
    await this.appDb.tx(ctx, async (tx) => {
      const row = await tx.integrationCredential.findFirst({
        where: { type: 'google_calendar', employeeId },
      });
      if (!row) return;
      await tx.integrationCredential.update({
        where: { id: row.id },
        data: {
          publicConfig: {
            ...(row.publicConfig as Record<string, unknown>),
            status,
          } as Prisma.InputJsonValue,
        },
      });
    });
    this.tokens.delete(this.cacheKey(tenantId, employeeId));
  }

  /** Ida: refleja un turno recien creado en el calendario del negocio y en
   *  el del empleado asignado (si conecto el suyo). */
  async pushAppointment(tenantId: string, appointmentId: string): Promise<void> {
    try {
      const ctx = { tenantId, actorType: 'system' as const };
      const data = await this.appDb.tx(ctx, async (tx) => {
        const appointment = await tx.appointment.findFirst({
          where: { id: appointmentId, deletedAt: null },
          include: { customer: true, service: true, employee: true },
        });
        const tenant = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { timezone: true },
        });
        return { appointment, timezone: tenant?.timezone ?? 'America/Asuncion' };
      });
      const { appointment, timezone } = data;
      if (!appointment) return;

      const cliente = `${appointment.customer.firstName} ${appointment.customer.lastName ?? ''}`.trim();
      const body = {
        summary: `${appointment.service?.name ?? 'Turno'} — ${cliente}`,
        description: [
          `Cliente: ${cliente} (${appointment.customer.phoneE164 ?? 'sin telefono'})`,
          appointment.employee
            ? `Atiende: ${appointment.employee.firstName} ${appointment.employee.lastName}`
            : null,
          appointment.notes ? `Nota: ${appointment.notes}` : null,
          'Agendado desde el panel PyMEs.',
        ]
          .filter(Boolean)
          .join('\n'),
        start: { dateTime: appointment.startsAt.toISOString(), timeZone: timezone },
        end: { dateTime: appointment.endsAt.toISOString(), timeZone: timezone },
        // Anti-eco: el barrido reciproco reconoce lo nuestro y no lo
        // reimporta como bloqueo.
        extendedProperties: { private: { pymes_appointment_id: appointment.id } },
      };

      const crear = async (token: string): Promise<string | null> => {
        const res = await fetch(`${this.env.GOOGLE_CALENDAR_API_URL}/calendars/primary/events`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          this.logger.warn(`push evento fallo tenant=${tenantId} turno=${appointmentId}: ${res.status}`);
          return null;
        }
        return ((await res.json()) as { id: string }).id;
      };

      if (!appointment.googleEventId) {
        const token = await this.accessToken(tenantId, null);
        if (token) {
          const eventId = await crear(token);
          if (eventId) {
            await this.appDb.tx(ctx, (tx) =>
              tx.appointment.update({ where: { id: appointmentId }, data: { googleEventId: eventId } }),
            );
            this.logger.log(`evento creado tenant=${tenantId} turno=${appointmentId} evento=${eventId}`);
          }
        }
      }
      if (appointment.employeeId && !appointment.employeeGoogleEventId) {
        const token = await this.accessToken(tenantId, appointment.employeeId);
        if (token) {
          const eventId = await crear(token);
          if (eventId) {
            await this.appDb.tx(ctx, (tx) =>
              tx.appointment.update({
                where: { id: appointmentId },
                data: { employeeGoogleEventId: eventId },
              }),
            );
            this.logger.log(
              `evento copiado al empleado=${appointment.employeeId} turno=${appointmentId} evento=${eventId}`,
            );
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `push evento error tenant=${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Ida: turno cancelado → se quitan sus eventos espejo (negocio y empleado). */
  async removeAppointment(tenantId: string, refs: AppointmentEventRefs): Promise<void> {
    const borrar = async (employeeId: string | null, googleEventId: string) => {
      try {
        const token = await this.accessToken(tenantId, employeeId);
        if (!token) return;
        const res = await fetch(
          `${this.env.GOOGLE_CALENDAR_API_URL}/calendars/primary/events/${encodeURIComponent(googleEventId)}`,
          { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
        );
        // 404/410: ya no existia (borrado a mano) — objetivo cumplido igual.
        if (!res.ok && res.status !== 404 && res.status !== 410) {
          this.logger.warn(`delete evento fallo tenant=${tenantId} evento=${googleEventId}: ${res.status}`);
        }
      } catch (error) {
        this.logger.warn(
          `delete evento error tenant=${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    if (refs.googleEventId) await borrar(null, refs.googleEventId);
    if (refs.employeeId && refs.employeeGoogleEventId) {
      await borrar(refs.employeeId, refs.employeeGoogleEventId);
    }
  }

  /** Vuelta reciproca: barrido incremental de todas las conexiones. */
  async sweep(): Promise<void> {
    try {
      // platform_ops puede listar credenciales cross-tenant (politica de
      // webhooks); cada sync corre despues scopeado a SU tenant.
      const rows = await this.platformDb.client.integrationCredential.findMany({
        where: { type: 'google_calendar', isActive: true },
        select: { tenantId: true, employeeId: true, publicConfig: true },
      });
      for (const row of rows) {
        const publicConfig = row.publicConfig as { status?: string };
        if (publicConfig.status !== 'connected') continue;
        await this.syncConnection(row.tenantId, row.employeeId).catch((error: unknown) =>
          this.logger.warn(
            `sync tenant=${row.tenantId} empleado=${row.employeeId ?? '-'} fallo: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    } catch (error) {
      this.logger.warn(`sweep fallo: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async syncConnection(tenantId: string, employeeId: string | null): Promise<void> {
    const token = await this.accessToken(tenantId, employeeId);
    if (!token) return;
    const ctx = { tenantId, actorType: 'system' as const };
    const row = await this.appDb.tx(ctx, (tx) =>
      tx.integrationCredential.findFirst({ where: { type: 'google_calendar', employeeId } }),
    );
    if (!row) return;
    const publicConfig = row.publicConfig as Record<string, unknown>;
    const timezone = await this.appDb
      .tx(ctx, (tx) => tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }))
      .then((t) => t?.timezone ?? 'America/Asuncion');

    let syncToken = (publicConfig['sync_token'] as string | null) ?? null;
    let pageToken: string | null = null;
    let nextSyncToken: string | null = null;

    do {
      const params = new URLSearchParams({ maxResults: '250', singleEvents: 'true' });
      if (pageToken) params.set('pageToken', pageToken);
      else if (syncToken) params.set('syncToken', syncToken);
      else {
        const now = new Date();
        params.set('timeMin', now.toISOString());
        params.set(
          'timeMax',
          new Date(now.getTime() + SYNC_HORIZON_DAYS * 86_400_000).toISOString(),
        );
      }
      const res = await fetch(
        `${this.env.GOOGLE_CALENDAR_API_URL}/calendars/primary/events?${params.toString()}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (res.status === 410) {
        // syncToken vencido: resync completo en la proxima pasada.
        syncToken = null;
        await this.saveSyncToken(row.id, ctx, null);
        return;
      }
      if (!res.ok) {
        this.logger.warn(`events.list fallo tenant=${tenantId} empleado=${employeeId ?? '-'}: ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      };
      for (const event of data.items ?? []) {
        await this.applyEvent(tenantId, employeeId, event, timezone);
      }
      pageToken = data.nextPageToken ?? null;
      nextSyncToken = data.nextSyncToken ?? nextSyncToken;
    } while (pageToken);

    if (nextSyncToken) await this.saveSyncToken(row.id, ctx, nextSyncToken);
  }

  private async applyEvent(
    tenantId: string,
    employeeId: string | null,
    event: GoogleEvent,
    timezone: string,
  ): Promise<void> {
    const ctx = { tenantId, actorType: 'system' as const };
    const nuestro = event.extendedProperties?.private?.['pymes_appointment_id'];

    if (nuestro) {
      // Evento NUESTRO borrado a mano: solo el calendario del NEGOCIO cancela
      // el turno (regla original). Borrarlo del calendario del empleado se
      // ignora: la agenda del negocio manda.
      if (event.status === 'cancelled' && employeeId === null) {
        await this.appDb.tx(ctx, async (tx) => {
          const updated = await tx.appointment.updateMany({
            where: { id: nuestro, status: { in: ['pending', 'confirmed'] } },
            data: { status: 'cancelled', googleEventId: null },
          });
          if (updated.count > 0) {
            this.logger.log(`turno ${nuestro} cancelado desde Google tenant=${tenantId}`);
          }
        });
      }
      return; // lo nuestro jamas se convierte en bloqueo (anti-eco)
    }

    if (event.status === 'cancelled') {
      await this.appDb.tx(ctx, (tx) =>
        tx.calendarBlock.deleteMany({ where: { googleEventId: event.id, employeeId } }),
      );
      return;
    }

    // Evento ajeno activo → bloqueo (de todo el negocio o solo del empleado
    // dueño de la conexion). Con hora exacta usa el rango tal cual; los de
    // dia completo bloquean el dia entero en la zona del tenant.
    let startsAt: Date | null = null;
    let endsAt: Date | null = null;
    if (event.start?.dateTime && event.end?.dateTime) {
      startsAt = new Date(event.start.dateTime);
      endsAt = new Date(event.end.dateTime);
    } else if (event.start?.date && event.end?.date) {
      startsAt = localToUtc(event.start.date, 0, 0, timezone);
      endsAt = localToUtc(event.end.date, 0, 0, timezone); // end.date es exclusivo
    }
    if (!startsAt || !endsAt || endsAt <= startsAt) return;

    await this.appDb.tx(ctx, async (tx) => {
      // Unicidad (tenant, evento, empleado) NULLS NOT DISTINCT: upsert manual.
      const existing = await tx.calendarBlock.findFirst({
        where: { googleEventId: event.id, employeeId },
      });
      if (existing) {
        await tx.calendarBlock.update({
          where: { id: existing.id },
          data: { startsAt, endsAt, summary: event.summary?.slice(0, 200) ?? null },
        });
      } else {
        await tx.calendarBlock.create({
          data: {
            tenantId,
            employeeId,
            googleEventId: event.id,
            startsAt,
            endsAt,
            summary: event.summary?.slice(0, 200) ?? null,
          },
        });
      }
    });
  }

  private async saveSyncToken(
    credentialId: string,
    ctx: { tenantId: string; actorType: 'system' },
    syncToken: string | null,
  ): Promise<void> {
    await this.appDb.tx(ctx, async (tx) => {
      const row = await tx.integrationCredential.findFirst({ where: { id: credentialId } });
      if (!row) return;
      await tx.integrationCredential.update({
        where: { id: row.id },
        data: {
          publicConfig: {
            ...(row.publicConfig as Record<string, unknown>),
            sync_token: syncToken,
          } as Prisma.InputJsonValue,
        },
      });
    });
  }
}
