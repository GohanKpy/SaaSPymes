import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@pymes/db';
import type { Env, MailSettingsPut, MailSettingsView } from '@pymes/shared';

import { CryptoService } from '../common/crypto.service';
import { ENV } from '../env.module';
import { PlatformPrisma } from '../prisma/platform-prisma.service';

const SETTING_KEY = 'smtp';
const CACHE_TTL_MS = 30_000;
/** Pisos tecnicos del respaldo por entorno (Mailpit del laboratorio). */
const DEFAULT_SMTP_PORT = 1025;
const DEFAULT_FROM_EMAIL = 'no-reply@pymes.local';
const DEFAULT_FROM_NAME = 'PyMEs SaaS';

interface MailPublic {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  from_email?: string;
  from_name?: string;
}
interface MailSecret {
  password?: string;
}

export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  fromEmail: string;
  fromName: string;
  source: 'panel' | 'env';
}

/**
 * Correo saliente del SISTEMA (2026-09-07): resumenes de cuenta y facturas
 * por email. Mismo patron que Google/Motor del bot: el portal admin manda,
 * cache de 30 s, contraseña cifrada. Sin registro rige SMTP_HOST del entorno
 * (Mailpit en el laboratorio) sin autenticacion.
 */
@Injectable()
export class MailSettingsService {
  private cache: { at: number; config: MailConfig } | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly platformDb: PlatformPrisma,
    private readonly crypto: CryptoService,
  ) {}

  async getConfig(): Promise<MailConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.config;
    const row = await this.platformDb.client.platformSetting.findUnique({ where: { key: SETTING_KEY } });
    const pub = (row?.publicConfig ?? {}) as MailPublic;
    const secret: MailSecret = row?.encryptedPayload ? this.crypto.decryptJson<MailSecret>(row.encryptedPayload) : {};
    const config: MailConfig = pub.host
      ? {
          host: pub.host,
          port: pub.port ?? 587,
          secure: pub.secure ?? false,
          user: pub.user || undefined,
          password: secret.password,
          fromEmail: pub.from_email ?? DEFAULT_FROM_EMAIL,
          fromName: pub.from_name ?? DEFAULT_FROM_NAME,
          source: 'panel',
        }
      : {
          host: this.env.SMTP_HOST,
          port: DEFAULT_SMTP_PORT,
          secure: false,
          fromEmail: DEFAULT_FROM_EMAIL,
          fromName: DEFAULT_FROM_NAME,
          source: 'env',
        };
    this.cache = { at: Date.now(), config };
    return config;
  }

  async view(): Promise<MailSettingsView> {
    const c = await this.getConfig();
    return {
      host: c.host,
      port: c.port,
      secure: c.secure,
      user: c.user ?? null,
      from_email: c.fromEmail,
      from_name: c.fromName,
      has_password: Boolean(c.password),
      source: c.source,
    };
  }

  async save(dto: MailSettingsPut, actorId: string, ip: string): Promise<MailSettingsView> {
    const row = await this.platformDb.client.platformSetting.findUnique({ where: { key: SETTING_KEY } });
    const existing: MailSecret = row?.encryptedPayload ? this.crypto.decryptJson<MailSecret>(row.encryptedPayload) : {};
    // Rotacion: la contraseña solo se pisa si llega una nueva.
    const secret: MailSecret = { password: dto.password ?? existing.password };
    const publicConfig = JSON.parse(
      JSON.stringify({
        host: dto.host,
        port: dto.port,
        secure: dto.secure,
        user: dto.user || undefined,
        from_email: dto.from_email,
        from_name: dto.from_name || undefined,
      } satisfies MailPublic),
    ) as Prisma.InputJsonValue;
    await this.platformDb.client.platformSetting.upsert({
      where: { key: SETTING_KEY },
      update: { publicConfig, encryptedPayload: this.crypto.encryptJson(secret), updatedBy: actorId },
      create: { key: SETTING_KEY, publicConfig, encryptedPayload: this.crypto.encryptJson(secret), updatedBy: actorId },
    });
    await this.platformDb.client.platformAuditLog.create({
      data: {
        actorId,
        action: 'settings.smtp.update',
        entity: 'platform_settings',
        ip,
        detail: { host: dto.host, port: dto.port, user: dto.user ?? null, rotated_password: Boolean(dto.password) },
      },
    });
    this.cache = null;
    return this.view();
  }
}
