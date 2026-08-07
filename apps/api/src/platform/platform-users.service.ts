import { randomBytes } from 'node:crypto';

import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { hash, verify as argonVerify } from '@node-rs/argon2';
import { Prisma } from '@pymes/db';
import type {
  PlatformPasswordChange,
  PlatformProfilePatch,
  PlatformUserCreate,
  PlatformUserUpdate,
} from '@pymes/shared';

import { PlatformPrisma } from '../prisma/platform-prisma.service';
import { ARGON2_OPTIONS } from './tenants.service';

/** Campos publicos de un operador: el hash y el secreto TOTP jamas salen. */
const SAFE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  totpEnabled: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

/**
 * Operadores del portal de plataforma (control.platform_users): perfil
 * propio y ABM solo-padmin. El propio usuario se gestiona por /me; el ABM
 * bloquea editarse a si mismo para que siempre quede al menos un admin
 * activo (el que ejecuta la accion).
 */
@Injectable()
export class PlatformUsersService {
  constructor(private readonly platformDb: PlatformPrisma) {}

  async profile(userId: string) {
    const user = await this.platformDb.client.platformUser.findUnique({
      where: { id: userId },
      select: SAFE_SELECT,
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  async updateProfile(userId: string, dto: PlatformProfilePatch, ip: string) {
    try {
      const updated = await this.platformDb.client.platformUser.update({
        where: { id: userId },
        data: { fullName: dto.full_name, email: dto.email, updatedAt: new Date() },
        select: SAFE_SELECT,
      });
      await this.audit(userId, 'platform_user.update_profile', userId, ip, {
        email: dto.email,
        full_name: dto.full_name,
      });
      return updated;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ title: 'Ese email ya lo usa otro operador' });
      }
      throw error;
    }
  }

  async changePassword(userId: string, dto: PlatformPasswordChange, ip: string) {
    const user = await this.platformDb.client.platformUser.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();
    if (!(await argonVerify(user.passwordHash, dto.current_password))) {
      throw new UnprocessableEntityException({ title: 'La contrasena actual no coincide' });
    }
    const passwordHash = await hash(dto.new_password, ARGON2_OPTIONS);
    await this.platformDb.client.platformUser.update({
      where: { id: userId },
      data: { passwordHash, updatedAt: new Date() },
    });
    await this.revokeSessions(userId);
    await this.audit(userId, 'platform_user.change_password', userId, ip);
    return { ok: true };
  }

  list() {
    return this.platformDb.client.platformUser.findMany({
      select: SAFE_SELECT,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Alta con contrasena temporal de un solo uso (mismo patron que tenants). */
  async create(actorId: string, dto: PlatformUserCreate, ip: string) {
    const tempPassword = randomBytes(9).toString('base64url');
    const passwordHash = await hash(tempPassword, ARGON2_OPTIONS);
    try {
      const user = await this.platformDb.client.platformUser.create({
        data: { email: dto.email, fullName: dto.full_name, role: dto.role, passwordHash },
        select: SAFE_SELECT,
      });
      await this.audit(actorId, 'platform_user.create', user.id, ip, {
        email: dto.email,
        role: dto.role,
      });
      return { user, temp_password: tempPassword };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ title: 'Ya existe un operador con ese email' });
      }
      throw error;
    }
  }

  async update(actorId: string, id: string, dto: PlatformUserUpdate, ip: string) {
    this.assertNotSelf(actorId, id);
    const existing = await this.platformDb.client.platformUser.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    const updated = await this.platformDb.client.platformUser.update({
      where: { id },
      data: {
        fullName: dto.full_name,
        role: dto.role,
        isActive: dto.is_active,
        updatedAt: new Date(),
      },
      select: SAFE_SELECT,
    });
    // Desactivado: sus sesiones abiertas mueren ya, no al expirar el access.
    if (dto.is_active === false) await this.revokeSessions(id);
    await this.audit(actorId, 'platform_user.update', id, ip, dto as Record<string, unknown>);
    return updated;
  }

  async resetPassword(actorId: string, id: string, ip: string) {
    this.assertNotSelf(actorId, id);
    const existing = await this.platformDb.client.platformUser.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException();
    const tempPassword = randomBytes(9).toString('base64url');
    const passwordHash = await hash(tempPassword, ARGON2_OPTIONS);
    await this.platformDb.client.platformUser.update({
      where: { id },
      data: { passwordHash, updatedAt: new Date() },
    });
    await this.revokeSessions(id);
    await this.audit(actorId, 'platform_user.reset_password', id, ip, { email: existing.email });
    return { email: existing.email, temp_password: tempPassword };
  }

  /** El propio usuario se toca por /me: evita auto-desactivarse o quitarse
   *  el rol admin y dejar el portal sin administradores. */
  private assertNotSelf(actorId: string, id: string): void {
    if (actorId === id) {
      throw new ConflictException({
        title: 'Tu propio usuario se edita desde "Mi perfil"',
      });
    }
  }

  /** Cambio de contrasena o desactivacion: cierra las sesiones abiertas. */
  private revokeSessions(userId: string) {
    return this.platformDb.client.refreshToken.updateMany({
      where: { userScope: 'platform', userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private audit(
    actorId: string,
    action: string,
    entityId: string,
    ip: string,
    detail?: Record<string, unknown>,
  ) {
    return this.platformDb.client.platformAuditLog.create({
      data: {
        actorId,
        action,
        entity: 'platform_users',
        entityId,
        ip,
        detail: (detail ?? {}) as Prisma.InputJsonValue,
      },
    });
  }
}
