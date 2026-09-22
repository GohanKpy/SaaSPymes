import { createHash, randomBytes } from 'node:crypto';

import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { verify as argonVerify } from '@node-rs/argon2';
import type { AuthUser, Env, LoginRequest, LoginResponse } from '@pymes/shared';

import { ipAllowed } from '../common/ip';
import { ENV } from '../env.module';
import { SecuritySettingsService } from '../platform/security-settings.service';
import { AppPrisma } from '../prisma/app-prisma.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';
import { JwtSigner } from './jwt.service';

/** Vida de una sesion de soporte (2026-09-22): corta y sin renovacion. */
const SUPPORT_TTL_MIN = 60;
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000; // 30 dias (doc 05 §3)

export interface IssuedSession {
  accessToken: string;
  refreshToken: string; // valor crudo: viaja SOLO en la cookie httpOnly
  user: AuthUser;
}

function sha256(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(value).digest()) as Uint8Array<ArrayBuffer>;
}

@Injectable()
export class AuthService {
  // Bloqueo por cuenta e IP (doc 05 §3) con valores vivos del modulo de
  // seguridad del portal admin. En memoria: suficiente para la instancia
  // unica de fase 1; a Redis/DB cuando haya mas de una.
  private readonly fails = new Map<
    string,
    { count: number; windowUntil: number; blockedUntil: number }
  >();

  constructor(
    private readonly appDb: AppPrisma,
    private readonly platformDb: PlatformPrisma,
    private readonly jwt: JwtSigner,
    private readonly security: SecuritySettingsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private assertNotLocked(keys: string[]): void {
    const now = Date.now();
    for (const key of keys) {
      const entry = this.fails.get(key);
      if (entry && entry.blockedUntil > now) {
        throw new HttpException(
          { title: 'Bloqueado temporalmente por intentos fallidos; proba mas tarde' },
          423,
        );
      }
    }
  }

  private async registerFail(keys: string[]): Promise<void> {
    const cfg = await this.security.getConfig();
    const now = Date.now();
    for (const key of keys) {
      let entry = this.fails.get(key);
      // La ventana de conteo vencida arranca de cero (no acumula para siempre).
      if (!entry || entry.windowUntil <= now) {
        entry = { count: 0, windowUntil: now + cfg.login_window_min * 60_000, blockedUntil: 0 };
      }
      entry.count += 1;
      if (entry.count >= cfg.login_max_attempts) {
        entry.blockedUntil = now + cfg.login_block_min * 60_000;
      }
      this.fails.set(key, entry);
    }
  }

  private clearFails(keys: string[]): void {
    for (const key of keys) this.fails.delete(key);
  }

  async login(
    dto: LoginRequest,
    ip: string,
    userAgent: string | undefined,
  ): Promise<{ session?: IssuedSession; response: LoginResponse }> {
    return dto.scope === 'platform'
      ? this.loginPlatform(dto, ip, userAgent)
      : this.loginTenant(dto, ip, userAgent);
  }

  private async loginTenant(
    dto: LoginRequest,
    ip: string,
    userAgent: string | undefined,
  ): Promise<{ session?: IssuedSession; response: LoginResponse }> {
    const lockKeys = [`t:${dto.email}`, `ip:${ip}`];
    this.assertNotLocked(lockKeys);

    // platform_ops: unica via legitima de buscar usuarios a traves de tenants
    // (politica platform_login_lookup). Respuestas sin filtrar existencia.
    const candidates = await this.platformDb.client.user.findMany({
      where: { email: dto.email, deletedAt: null, isActive: true },
    });
    const matched = [];
    for (const user of candidates) {
      if (await argonVerify(user.passwordHash, dto.password)) matched.push(user);
    }
    if (matched.length === 0) {
      await this.registerFail(lockKeys);
      throw new UnauthorizedException();
    }
    return this.finishTenantLogin(matched, dto.tenant_id, lockKeys, ip, userAgent, 'auth.login');
  }

  /**
   * Login por identidad verificada por Google (2026-09-22, ADR 0014): el
   * email ya fue probado; solo cuentan los usuarios activos con ese email.
   * Sin registro automatico: un email que no existe en ningun negocio no entra.
   */
  async loginTenantByEmail(
    email: string,
    tenantId: string | undefined,
    ip: string,
    userAgent: string | undefined,
  ): Promise<{ session?: IssuedSession; response: LoginResponse }> {
    const lockKeys = [`t:${email}`, `ip:${ip}`];
    this.assertNotLocked(lockKeys);
    const matched = await this.platformDb.client.user.findMany({
      where: { email, deletedAt: null, isActive: true },
    });
    if (matched.length === 0) {
      await this.registerFail(lockKeys);
      throw new UnauthorizedException({ title: 'Esa cuenta de Google no tiene usuario en ningún negocio' });
    }
    return this.finishTenantLogin(matched, tenantId, lockKeys, ip, userAgent, 'auth.login_google');
  }

  private async finishTenantLogin(
    matched: { id: string; tenantId: string; email: string; fullName: string; role: string }[],
    tenantId: string | undefined,
    lockKeys: string[],
    ip: string,
    userAgent: string | undefined,
    action: 'auth.login' | 'auth.login_google',
  ): Promise<{ session?: IssuedSession; response: LoginResponse }> {
    const tenants = await this.platformDb.client.tenant.findMany({
      where: { id: { in: matched.map((u) => u.tenantId) } },
    });
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    const usable = matched.filter((u) =>
      ['trial', 'active'].includes(tenantById.get(u.tenantId)?.status ?? ''),
    );
    if (usable.length === 0) {
      // Password correcta pero tenant suspendido/cerrado: bloquea el login
      // de todos los usuarios del tenant (doc 08 §5).
      throw new ForbiddenException({
        type: 'https://docs.pymes.local/errors/tenant-suspended',
        title: 'La cuenta de la empresa esta suspendida',
      });
    }

    const chosen = tenantId ? usable.filter((u) => u.tenantId === tenantId) : usable;
    if (chosen.length === 0) throw new UnauthorizedException();
    if (chosen.length > 1) {
      // Mismo email en varios tenants: segunda vuelta con eleccion explicita.
      return {
        response: {
          tenant_options: chosen.map((u) => {
            const tenant = tenantById.get(u.tenantId);
            return { id: u.tenantId, name: tenant?.tradeName ?? tenant?.legalName ?? '' };
          }),
        },
      };
    }

    const user = chosen[0];
    if (!user) throw new UnauthorizedException();
    this.clearFails(lockKeys);

    // Sucursales para claims de staff; root/admin ven todas (doc 03 §3.1).
    const branchIds =
      user.role === 'staff'
        ? (
            await this.appDb.tx({ tenantId: user.tenantId }, (tx) =>
              tx.userBranchAccess.findMany({ where: { userId: user.id } }),
            )
          ).map((a) => a.branchId)
        : undefined;

    await this.appDb.tx({ tenantId: user.tenantId, userId: user.id }, async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await tx.auditLog.create({
        data: {
          tenantId: user.tenantId,
          actorUserId: user.id,
          action,
          entity: 'users',
          entityId: user.id,
          ip,
        },
      });
    });

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
      scope: 'tenant',
      tenant_id: user.tenantId,
      branches: branchIds,
    };
    const session = await this.issueSession(authUser, ip, userAgent);
    return { session, response: { access_token: session.accessToken, user: authUser } };
  }

  /** Login de plataforma por identidad de Google (2026-09-22): mismas reglas de IP, TOTP y bloqueo. */
  async loginPlatformByEmail(
    email: string,
    ip: string,
    userAgent: string | undefined,
  ): Promise<{ session?: IssuedSession; response: LoginResponse }> {
    if (!ipAllowed(ip, this.env.PLATFORM_ALLOWED_IPS)) throw new NotFoundException();
    const lockKeys = [`p:${email}`, `ip:${ip}`];
    this.assertNotLocked(lockKeys);
    const user = await this.platformDb.client.platformUser.findUnique({ where: { email } });
    if (!user || !user.isActive) {
      await this.registerFail(lockKeys);
      throw new UnauthorizedException({ title: 'Esa cuenta de Google no es un usuario del portal' });
    }
    if (user.totpEnabled) throw new HttpException({ title: 'Se requiere codigo TOTP' }, 428);
    this.clearFails(lockKeys);
    await this.platformDb.client.platformUser.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.platformDb.client.platformAuditLog.create({
      data: { actorId: user.id, action: 'auth.login_google', entity: 'platform_users', entityId: user.id, ip },
    });
    const authUser: AuthUser = { id: user.id, email: user.email, full_name: user.fullName, role: user.role, scope: 'platform' };
    const session = await this.issueSession(authUser, ip, userAgent);
    return { session, response: { access_token: session.accessToken, user: authUser } };
  }

  /**
   * Sesion de soporte (2026-09-22, ADR 0014): un agente de la plataforma
   * entra al panel de un negocio con el token que el cliente le dio. Access
   * token de 60 minutos, sin cookie de refresh, claims sup/spe: el panel lo
   * muestra y la auditoria lo distingue del cliente.
   */
  async issueSupportSession(
    tenantId: string,
    agent: { id: string; email: string; fullName: string },
    ip: string,
  ): Promise<LoginResponse> {
    const until = new Date(Date.now() + SUPPORT_TTL_MIN * 60_000);
    await this.appDb.tx({ tenantId, userId: agent.id, actorType: 'platform', ip }, (tx) =>
      tx.auditLog.create({
        data: { tenantId, actorUserId: agent.id, actorType: 'platform', action: 'auth.support_login', entity: 'tenants', entityId: tenantId, ip },
      }),
    );
    const accessToken = await this.jwt.signAccess(
      { sub: agent.id, scope: 'tenant', tid: tenantId, role: 'root', sup: true, spe: agent.email },
      `${SUPPORT_TTL_MIN}m`,
    );
    return {
      access_token: accessToken,
      user: {
        id: agent.id,
        email: agent.email,
        full_name: `Soporte · ${agent.fullName}`,
        role: 'root',
        scope: 'tenant',
        tenant_id: tenantId,
        support: { agent: agent.email, until: until.toISOString() },
      },
    };
  }

  private async loginPlatform(
    dto: LoginRequest,
    ip: string,
    userAgent: string | undefined,
  ): Promise<{ session?: IssuedSession; response: LoginResponse }> {
    // ADR 0004: el login del portal admin respeta la lista de IPs; fuera
    // de ella responde 404 opaco (misma respuesta que una ruta inexistente).
    if (!ipAllowed(ip, this.env.PLATFORM_ALLOWED_IPS)) throw new NotFoundException();
    const lockKeys = [`p:${dto.email}`, `ip:${ip}`];
    this.assertNotLocked(lockKeys);

    const user = await this.platformDb.client.platformUser.findUnique({
      where: { email: dto.email },
    });
    if (!user || !user.isActive || !(await argonVerify(user.passwordHash, dto.password))) {
      await this.registerFail(lockKeys);
      throw new UnauthorizedException();
    }
    if (user.totpEnabled) {
      // TOTP obligatorio de plataforma (doc 05 §3): verificacion pendiente de
      // implementar; hasta entonces una cuenta con TOTP activo no inicia sesion.
      throw new HttpException({ title: 'Se requiere codigo TOTP' }, 428);
    }
    this.clearFails(lockKeys);

    await this.platformDb.client.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.platformDb.client.platformAuditLog.create({
      data: { actorId: user.id, action: 'auth.login', entity: 'platform_users', entityId: user.id, ip },
    });

    const authUser: AuthUser = {
      id: user.id,
      email: user.email,
      full_name: user.fullName,
      role: user.role,
      scope: 'platform',
    };
    const session = await this.issueSession(authUser, ip, userAgent);
    return { session, response: { access_token: session.accessToken, user: authUser } };
  }

  private async issueSession(
    user: AuthUser,
    ip: string,
    userAgent: string | undefined,
  ): Promise<IssuedSession> {
    const refreshToken = randomBytes(48).toString('base64url');
    await this.platformDb.client.refreshToken.create({
      data: {
        tenantId: user.scope === 'tenant' ? user.tenant_id : null,
        userId: user.id,
        userScope: user.scope,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        userAgent: userAgent?.slice(0, 300),
        ip,
      },
    });
    const accessToken = await this.jwt.signAccess({
      sub: user.id,
      scope: user.scope,
      tid: user.tenant_id,
      role: user.role,
      branches: user.branches,
    });
    return { accessToken, refreshToken, user };
  }

  async refresh(
    rawToken: string,
    ip: string,
    userAgent: string | undefined,
  ): Promise<IssuedSession> {
    const stored = await this.platformDb.client.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!stored) throw new UnauthorizedException();

    if (stored.revokedAt || stored.replacedBy) {
      // Reuso de un refresh ya rotado = robo: se revoca TODO (doc 05 §3).
      await this.platformDb.client.refreshToken.updateMany({
        where: { userScope: stored.userScope, userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException();
    }
    if (stored.expiresAt < new Date()) throw new UnauthorizedException();

    const user = await this.rebuildUser(stored.userScope, stored.userId);
    const session = await this.issueSession(user, ip, userAgent);
    const replacement = await this.platformDb.client.refreshToken.findUnique({
      where: { tokenHash: sha256(session.refreshToken) },
    });
    await this.platformDb.client.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedBy: replacement?.id },
    });
    return session;
  }

  private async rebuildUser(scope: string, userId: string): Promise<AuthUser> {
    if (scope === 'platform') {
      const u = await this.platformDb.client.platformUser.findUnique({ where: { id: userId } });
      if (!u || !u.isActive) throw new UnauthorizedException();
      return { id: u.id, email: u.email, full_name: u.fullName, role: u.role, scope: 'platform' };
    }
    const u = await this.platformDb.client.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
    });
    if (!u) throw new UnauthorizedException();
    const tenant = await this.platformDb.client.tenant.findUnique({ where: { id: u.tenantId } });
    if (!tenant || !['trial', 'active'].includes(tenant.status)) {
      throw new UnauthorizedException();
    }
    const branches =
      u.role === 'staff'
        ? (
            await this.appDb.tx({ tenantId: u.tenantId }, (tx) =>
              tx.userBranchAccess.findMany({ where: { userId: u.id } }),
            )
          ).map((a) => a.branchId)
        : undefined;
    return {
      id: u.id,
      email: u.email,
      full_name: u.fullName,
      role: u.role,
      scope: 'tenant',
      tenant_id: u.tenantId,
      branches,
    };
  }

  async logout(rawToken: string): Promise<void> {
    const stored = await this.platformDb.client.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!stored) return;
    // Revoca la cadena completa hacia adelante (doc 04 §3.1).
    let current: typeof stored | null = stored;
    while (current && !current.revokedAt) {
      await this.platformDb.client.refreshToken.update({
        where: { id: current.id },
        data: { revokedAt: new Date() },
      });
      current = current.replacedBy
        ? await this.platformDb.client.refreshToken.findUnique({ where: { id: current.replacedBy } })
        : null;
    }
  }
}
