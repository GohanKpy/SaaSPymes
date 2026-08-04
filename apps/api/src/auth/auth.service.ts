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
import { AppPrisma } from '../prisma/app-prisma.service';
import { PlatformPrisma } from '../prisma/platform-prisma.service';
import { JwtSigner } from './jwt.service';

const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000; // 30 dias (doc 05 §3)
const LOCK_MAX_FAILS = 5;
const LOCK_WINDOW_MS = 15 * 60 * 1000;

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
  // Bloqueo progresivo por cuenta e IP (doc 05 §3). En memoria: suficiente
  // para la instancia unica de fase 1; a Redis/DB cuando haya mas de una.
  private readonly fails = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly appDb: AppPrisma,
    private readonly platformDb: PlatformPrisma,
    private readonly jwt: JwtSigner,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private assertNotLocked(keys: string[]): void {
    const now = Date.now();
    for (const key of keys) {
      const entry = this.fails.get(key);
      if (entry && entry.count >= LOCK_MAX_FAILS && entry.until > now) {
        throw new HttpException(
          { title: 'Cuenta bloqueada temporalmente por intentos fallidos' },
          423,
        );
      }
    }
  }

  private registerFail(keys: string[]): void {
    const until = Date.now() + LOCK_WINDOW_MS;
    for (const key of keys) {
      const entry = this.fails.get(key) ?? { count: 0, until };
      entry.count += 1;
      entry.until = until;
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
      this.registerFail(lockKeys);
      throw new UnauthorizedException();
    }

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

    const chosen = dto.tenant_id ? usable.filter((u) => u.tenantId === dto.tenant_id) : usable;
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
          action: 'auth.login',
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
      this.registerFail(lockKeys);
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
