import { randomUUID } from 'node:crypto';

import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { googleComplete, googleStartQuery, supportComplete, type Env, type GoogleComplete, type GoogleStartQuery, type LoginResponse, type SupportComplete } from '@pymes/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { CryptoService } from '../common/crypto.service';
import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../env.module';
import { GoogleOauthService } from '../platform/google-oauth.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';

import { AuthService, type IssuedSession } from './auth.service';
import { Public } from './decorators';

// Inicio de sesion con Google y sesion de soporte (2026-09-22, ADR 0014).
// Los codigos de un solo uso van cifrados (AES-GCM del sistema) con
// vencimiento corto; el jti evita reusar uno dentro de ese minuto.

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_PATH = '/api/v1/auth';
const STATE_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 60_000;

interface GoogleState {
  k: 'gstate';
  s: 'tenant' | 'platform';
  o: string;
  exp: number;
  n: string;
}
interface GoogleCode {
  k: 'gcode';
  e: string;
  s: 'tenant' | 'platform';
  exp: number;
  n: string;
}
export interface SupportCode {
  k: 'support';
  tid: string;
  pid: string;
  exp: number;
  n: string;
}

@Controller('auth')
export class SsoController {
  /** Codigos ya canjeados (jti → vencimiento): un codigo vale una sola vez. */
  private readonly usados = new Map<string, number>();

  constructor(
    private readonly auth: AuthService,
    private readonly googleOauth: GoogleOauthService,
    private readonly crypto: CryptoService,
    private readonly platformDb: PlatformPrisma,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private setRefreshCookie(reply: FastifyReply, session: IssuedSession): void {
    void reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.env.NODE_ENV === 'production',
      path: COOKIE_PATH,
      maxAge: 30 * 24 * 3600,
    });
  }

  private origenPermitido(origin: string): boolean {
    const permitidos = this.env.WEB_ORIGIN.split(',').map((o) => o.trim());
    return permitidos.includes(origin) || (this.env.NODE_ENV !== 'production' && /^https?:\/\/[^/]+:430[08]$/.test(origin));
  }

  private redirectUri(req: FastifyRequest): string {
    const base = this.env.PUBLIC_API_URL?.replace(/\/$/, '') || `${req.protocol}://${req.hostname}`;
    return `${base}/api/v1/auth/google/callback`;
  }

  private consumir(n: string, exp: number): void {
    const ahora = Date.now();
    for (const [k, e] of this.usados) if (e < ahora) this.usados.delete(k);
    if (exp < ahora) throw new UnauthorizedException({ title: 'El código venció: volvé a intentar' });
    if (this.usados.has(n)) throw new UnauthorizedException({ title: 'El código ya se usó' });
    this.usados.set(n, exp);
  }

  private sellar(payload: unknown): string {
    return Buffer.from(this.crypto.encryptJson(payload)).toString('base64url');
  }

  private abrir<T extends { k: string }>(code: string, kind: T['k']): T {
    try {
      const payload = this.crypto.decryptJson<T>(new Uint8Array(Buffer.from(code, 'base64url')));
      if (!payload || payload.k !== kind) throw new Error('kind');
      return payload;
    } catch {
      throw new UnauthorizedException({ title: 'Código inválido' });
    }
  }

  // ------------------------------------------------------------ Google ----

  /** El panel lo consulta para mostrar (o no) el boton "Entrar con Google". */
  @Public()
  @Get('google/config')
  async googleConfig() {
    const cfg = await this.googleOauth.getConfig();
    return { enabled: Boolean(cfg.signInEnabled && cfg.clientId && cfg.clientSecret) };
  }

  /** Redirige a Google con un state cifrado (scope + origen del panel). */
  @Public()
  @Get('google/start')
  async googleStart(@Query(new ZodPipe(googleStartQuery)) q: GoogleStartQuery, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const cfg = await this.googleOauth.getConfig();
    if (!cfg.signInEnabled || !cfg.clientId || !cfg.clientSecret) throw new BadRequestException({ title: 'El inicio de sesión con Google no está habilitado' });
    const origin = q.origin.replace(/\/$/, '');
    if (!this.origenPermitido(origin)) throw new BadRequestException({ title: 'Origen no permitido' });
    const state: GoogleState = { k: 'gstate', s: q.scope, o: origin, exp: Date.now() + STATE_TTL_MS, n: randomUUID() };
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: this.redirectUri(req),
      response_type: 'code',
      scope: 'openid email profile',
      prompt: 'select_account',
      state: this.sellar(state),
    });
    return reply.redirect(`${this.env.GOOGLE_OAUTH_AUTH_URL}?${params.toString()}`, 302);
  }

  /** Vuelta de Google: canjea el code, toma el email verificado y manda al panel un codigo de un solo uso. */
  @Public()
  @Get('google/callback')
  async googleCallback(@Query() q: Record<string, string | undefined>, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    let state: GoogleState;
    try {
      state = this.abrir<GoogleState>(q.state ?? '', 'gstate');
    } catch {
      return reply.redirect(`${this.env.WEB_ORIGIN.split(',')[0]?.trim() ?? ''}/login?google_error=state`, 302);
    }
    const loginPath = state.s === 'platform' ? '/platform/login' : '/login';
    const volver = (error: string) => reply.redirect(`${state.o}${loginPath}?google_error=${encodeURIComponent(error)}`, 302);
    if (state.exp < Date.now()) return volver('vencido');
    if (q.error || !q.code) return volver(q.error ?? 'sin_codigo');
    const cfg = await this.googleOauth.getConfig();
    if (!cfg.clientId || !cfg.clientSecret) return volver('config');
    const res = await fetch(this.env.GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: q.code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: this.redirectUri(req),
        grant_type: 'authorization_code',
      }),
    });
    if (!res.ok) return volver('canje');
    const tokens = (await res.json()) as { id_token?: string };
    const claims = decodeJwtPayload(tokens.id_token);
    if (!claims?.email || claims.email_verified !== true) return volver('email_no_verificado');
    const code: GoogleCode = { k: 'gcode', e: claims.email.toLowerCase(), s: state.s, exp: Date.now() + CODE_TTL_MS, n: randomUUID() };
    return reply.redirect(`${state.o}${loginPath}?google=${encodeURIComponent(this.sellar(code))}`, 302);
  }

  /** Cierra el login con Google: misma respuesta que /auth/login (cookie de refresh, eleccion de empresa). */
  @Public()
  @Post('google/complete')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 300)
  async googleComplete(@Body(new ZodPipe(googleComplete)) dto: GoogleComplete, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<LoginResponse> {
    if (!req.headers['x-requested-with']) throw new BadRequestException({ title: 'Falta X-Requested-With' });
    const code = this.abrir<GoogleCode>(dto.code, 'gcode');
    const ua = req.headers['user-agent'];
    const result = code.s === 'platform' ? await this.auth.loginPlatformByEmail(code.e, req.ip, ua) : await this.auth.loginTenantByEmail(code.e, dto.tenant_id, req.ip, ua);
    // Con eleccion de empresa pendiente el codigo sigue valido para la segunda vuelta (dentro del minuto).
    if (result.session) {
      this.consumir(code.n, code.exp);
      this.setRefreshCookie(reply, result.session);
    } else if (code.exp < Date.now()) {
      throw new UnauthorizedException({ title: 'El código venció: volvé a intentar' });
    }
    return result.response;
  }

  // ------------------------------------------------------------ soporte ----

  /** El panel del cliente abre la sesion de soporte con el codigo que emitio el portal admin. */
  @Public()
  @Post('support/complete')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 300)
  async supportComplete(@Body(new ZodPipe(supportComplete)) dto: SupportComplete, @Req() req: FastifyRequest): Promise<LoginResponse> {
    if (!req.headers['x-requested-with']) throw new BadRequestException({ title: 'Falta X-Requested-With' });
    const code = this.abrir<SupportCode>(dto.code, 'support');
    this.consumir(code.n, code.exp);
    const agent = await this.platformDb.client.platformUser.findUnique({ where: { id: code.pid } });
    if (!agent || !agent.isActive) throw new UnauthorizedException();
    return this.auth.issueSupportSession(code.tid, { id: agent.id, email: agent.email, fullName: agent.fullName }, req.ip);
  }
}

/** Payload de un JWT sin verificar firma: solo para el id_token que Google acaba de entregarnos por TLS. */
function decodeJwtPayload(token: string | undefined): { email?: string; email_verified?: boolean } | null {
  if (!token) return null;
  const parte = token.split('.')[1];
  if (!parte) return null;
  try {
    return JSON.parse(Buffer.from(parte, 'base64url').toString('utf8')) as { email?: string; email_verified?: boolean };
  } catch {
    return null;
  }
}
