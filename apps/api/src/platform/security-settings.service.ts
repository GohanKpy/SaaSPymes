import { Injectable } from '@nestjs/common';
import type { SecuritySettingsPut } from '@pymes/shared';

import { Prisma } from '@pymes/db';

import { PlatformPrisma } from '../prisma/platform-prisma.service';

const SETTING_KEY = 'security';
const CACHE_TTL_MS = 30_000;

export interface SecurityConfig {
  /** Intentos fallidos (por IP y por cuenta) antes de bloquear. */
  login_max_attempts: number;
  /** Ventana de conteo de fallos, en minutos. */
  login_window_min: number;
  /** Duracion del bloqueo al exceder, en minutos. */
  login_block_min: number;
}

// Estandar definido por el dueño del sistema (2026-08-05): 10 intentos en
// 10 minutos, bloqueo de 10 minutos. Editable desde el modulo de seguridad.
const DEFAULTS: SecurityConfig = {
  login_max_attempts: 10,
  login_window_min: 10,
  login_block_min: 10,
};

/**
 * Config de seguridad viva (mismo patron que el motor del bot, ADR 0003):
 * el panel manda, con defaults sanos; cache 30 s, sin deploy ni reinicio.
 */
@Injectable()
export class SecuritySettingsService {
  private cache: { at: number; config: SecurityConfig } | null = null;

  constructor(private readonly platformDb: PlatformPrisma) {}

  async getConfig(): Promise<SecurityConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.config;
    const row = await this.platformDb.client.platformSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    const stored = (row?.publicConfig ?? {}) as Partial<SecurityConfig>;
    const config: SecurityConfig = { ...DEFAULTS, ...stored };
    this.cache = { at: Date.now(), config };
    return config;
  }

  async view(): Promise<SecurityConfig & { source: 'panel' | 'default' }> {
    const row = await this.platformDb.client.platformSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    const stored = (row?.publicConfig ?? {}) as Partial<SecurityConfig>;
    return { ...DEFAULTS, ...stored, source: row ? 'panel' : 'default' };
  }

  async save(dto: SecuritySettingsPut, actorId: string, ip: string): Promise<SecurityConfig> {
    const publicConfig = {
      login_max_attempts: dto.login_max_attempts,
      login_window_min: dto.login_window_min,
      login_block_min: dto.login_block_min,
    };
    await this.platformDb.client.platformSetting.upsert({
      where: { key: SETTING_KEY },
      update: { publicConfig, updatedBy: actorId },
      create: { key: SETTING_KEY, publicConfig, updatedBy: actorId },
    });
    await this.platformDb.client.platformAuditLog.create({
      data: {
        actorId,
        action: 'security.update',
        entity: 'platform_settings',
        ip,
        detail: publicConfig as Prisma.InputJsonValue,
      },
    });
    this.cache = null;
    return publicConfig;
  }
}
