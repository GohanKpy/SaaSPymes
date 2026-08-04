import { Inject, Injectable } from '@nestjs/common';
import type { BotEngineSettingsPut, BotEngineSettingsView, Env } from '@pymes/shared';

import { CryptoService } from '../common/crypto.service';
import { ENV } from '../env.module';
import { PlatformPrisma } from '../prisma/platform-prisma.service';

const SETTING_KEY = 'bot_engine';
const CACHE_TTL_MS = 30_000;

interface BotEngineSecret {
  openai_api_key?: string;
  anthropic_api_key?: string;
}
interface BotEnginePublic {
  provider?: 'openai' | 'anthropic';
  model?: string | null;
}

export interface BotEngineConfig {
  provider: 'openai' | 'anthropic';
  model: string | undefined;
  apiKey: string | undefined;
  source: 'panel' | 'env';
}

/**
 * Configuracion del motor del bot (ADR 0003): la fila 'bot_engine' de
 * control.platform_settings manda; el entorno queda como fallback para
 * instalaciones nuevas. Cache corto: rotar llave/modelo/proveedor desde el
 * panel rige en menos de 30 s sin redeploy.
 */
@Injectable()
export class BotEngineService {
  private cache: { at: number; config: BotEngineConfig } | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly platformDb: PlatformPrisma,
    private readonly crypto: CryptoService,
  ) {}

  async getConfig(): Promise<BotEngineConfig> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.config;

    const row = await this.platformDb.client.platformSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    const publicConfig = (row?.publicConfig ?? {}) as BotEnginePublic;
    const secret: BotEngineSecret = row?.encryptedPayload
      ? this.crypto.decryptJson<BotEngineSecret>(row.encryptedPayload)
      : {};

    const provider = publicConfig.provider ?? this.env.BOT_PROVIDER;
    const dbKey = provider === 'openai' ? secret.openai_api_key : secret.anthropic_api_key;
    const envKey = provider === 'openai' ? this.env.OPENAI_API_KEY : this.env.ANTHROPIC_API_KEY;

    const config: BotEngineConfig = {
      provider,
      model: publicConfig.model ?? this.env.BOT_MODEL,
      apiKey: dbKey ?? envKey,
      source: row ? 'panel' : 'env',
    };
    this.cache = { at: Date.now(), config };
    return config;
  }

  async view(): Promise<BotEngineSettingsView> {
    const row = await this.platformDb.client.platformSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    const publicConfig = (row?.publicConfig ?? {}) as BotEnginePublic;
    const secret: BotEngineSecret = row?.encryptedPayload
      ? this.crypto.decryptJson<BotEngineSecret>(row.encryptedPayload)
      : {};
    return {
      provider: publicConfig.provider ?? this.env.BOT_PROVIDER,
      model: publicConfig.model ?? this.env.BOT_MODEL ?? null,
      keys: {
        openai: Boolean(secret.openai_api_key ?? this.env.OPENAI_API_KEY),
        anthropic: Boolean(secret.anthropic_api_key ?? this.env.ANTHROPIC_API_KEY),
      },
      source: row ? 'panel' : 'env',
    };
  }

  async save(dto: BotEngineSettingsPut, actorId: string, ip: string): Promise<BotEngineSettingsView> {
    const row = await this.platformDb.client.platformSetting.findUnique({
      where: { key: SETTING_KEY },
    });
    const existing: BotEngineSecret = row?.encryptedPayload
      ? this.crypto.decryptJson<BotEngineSecret>(row.encryptedPayload)
      : {};
    // Rotacion: solo se pisan las llaves que llegan; el resto se conserva.
    const secret: BotEngineSecret = {
      openai_api_key: dto.openai_api_key ?? existing.openai_api_key,
      anthropic_api_key: dto.anthropic_api_key ?? existing.anthropic_api_key,
    };
    const publicConfig = { provider: dto.provider, model: dto.model ?? null };

    await this.platformDb.client.platformSetting.upsert({
      where: { key: SETTING_KEY },
      update: {
        publicConfig,
        encryptedPayload: this.crypto.encryptJson(secret),
        updatedBy: actorId,
      },
      create: {
        key: SETTING_KEY,
        publicConfig,
        encryptedPayload: this.crypto.encryptJson(secret),
        updatedBy: actorId,
      },
    });
    // Auditoria sin secretos: solo que cambio y quien (doc 05 §8).
    await this.platformDb.client.platformAuditLog.create({
      data: {
        actorId,
        action: 'settings.bot_engine.update',
        entity: 'platform_settings',
        ip,
        detail: {
          provider: dto.provider,
          model: dto.model ?? null,
          rotated_openai: Boolean(dto.openai_api_key),
          rotated_anthropic: Boolean(dto.anthropic_api_key),
        },
      },
    });
    this.cache = null;
    return this.view();
  }
}
