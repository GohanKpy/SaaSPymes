import { Inject, Injectable } from '@nestjs/common';
import type { Env, GoogleOauthSettingsPut, GoogleOauthSettingsView } from '@pymes/shared';

import { CryptoService } from '../common/crypto.service';
import { ENV } from '../env.module';
import { PlatformPrisma } from '../prisma/platform-prisma.service';

const SETTING_KEY = 'google_oauth';
const CACHE_TTL_MS = 30_000;

interface GoogleOauthSecret {
  client_secret?: string;
}
interface GoogleOauthPublic {
  client_id?: string;
}

export interface GoogleOauthConfig {
  clientId: string | undefined;
  clientSecret: string | undefined;
}

/**
 * App OAuth de Google del SISTEMA (ADR 0007): identifica al software ante
 * Google — una sola para toda la plataforma, como la app de Meta. Lo que es
 * de cada tenant (su cuenta, su calendario, su refresh token) vive en
 * integration_credentials type google_calendar. Mismo patron que el motor
 * del bot (ADR 0003): el panel admin manda, cache de 30 s, secreto cifrado.
 */
@Injectable()
export class GoogleOauthService {
  private cache: { at: number; config: GoogleOauthConfig } | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly platformDb: PlatformPrisma,
    private readonly crypto: CryptoService,
  ) {}

  async getConfig(): Promise<GoogleOauthConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.config;
    const row = await this.platformDb.client.platformSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    const publicConfig = (row?.publicConfig ?? {}) as GoogleOauthPublic;
    const secret: GoogleOauthSecret = row?.encryptedPayload
      ? this.crypto.decryptJson<GoogleOauthSecret>(row.encryptedPayload)
      : {};
    const config: GoogleOauthConfig = {
      clientId: publicConfig.client_id,
      clientSecret: secret.client_secret,
    };
    this.cache = { at: Date.now(), config };
    return config;
  }

  async view(): Promise<GoogleOauthSettingsView> {
    const config = await this.getConfig();
    return {
      client_id: config.clientId ?? null,
      has_secret: Boolean(config.clientSecret),
    };
  }

  async save(
    dto: GoogleOauthSettingsPut,
    actorId: string,
    ip: string,
  ): Promise<GoogleOauthSettingsView> {
    const row = await this.platformDb.client.platformSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    const existing: GoogleOauthSecret = row?.encryptedPayload
      ? this.crypto.decryptJson<GoogleOauthSecret>(row.encryptedPayload)
      : {};
    // Rotacion: el secret solo se pisa si llega uno nuevo.
    const secret: GoogleOauthSecret = {
      client_secret: dto.client_secret ?? existing.client_secret,
    };
    const publicConfig = { client_id: dto.client_id };
    await this.platformDb.client.platformSetting.upsert({
      where: { key: SETTING_KEY },
      update: { publicConfig, encryptedPayload: this.crypto.encryptJson(secret), updatedBy: actorId },
      create: {
        key: SETTING_KEY,
        publicConfig,
        encryptedPayload: this.crypto.encryptJson(secret),
        updatedBy: actorId,
      },
    });
    await this.platformDb.client.platformAuditLog.create({
      data: {
        actorId,
        action: 'settings.google_oauth.update',
        entity: 'platform_settings',
        ip,
        detail: { client_id: dto.client_id, rotated_secret: Boolean(dto.client_secret) },
      },
    });
    this.cache = null;
    return this.view();
  }
}
