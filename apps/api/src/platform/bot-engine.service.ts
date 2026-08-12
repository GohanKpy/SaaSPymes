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
  base_prompt?: string | null;
  reply_debounce_seconds?: number;
  hourly_budget_divisor?: number;
  fallback_notice?: string | null;
  budget_notice?: string | null;
}

// Defaults de sistema: rigen solo mientras el dueño no configure otra cosa
// desde su panel (regla: nada funcional hardcodeado).
export const DEFAULT_REPLY_DEBOUNCE_SECONDS = 15;
export const DEFAULT_HOURLY_BUDGET_DIVISOR = 8;
export const DEFAULT_FALLBACK_NOTICE =
  'Gracias por tu mensaje! En breve una persona del equipo te responde por este mismo chat.';
export const DEFAULT_BUDGET_NOTICE =
  'Gracias por escribirnos. En este momento una persona del negocio va a continuar la conversacion por este mismo chat.';

export interface BotEngineConfig {
  provider: 'openai' | 'anthropic';
  model: string | undefined;
  apiKey: string | undefined;
  /** Guia estandar editada por el dueño; null = default del sistema (ADR 0008). */
  basePrompt: string | null;
  replyDebounceMs: number;
  hourlyBudgetDivisor: number;
  fallbackNotice: string;
  budgetNotice: string;
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
      basePrompt: publicConfig.base_prompt ?? null,
      replyDebounceMs:
        (publicConfig.reply_debounce_seconds ?? DEFAULT_REPLY_DEBOUNCE_SECONDS) * 1000,
      hourlyBudgetDivisor: publicConfig.hourly_budget_divisor ?? DEFAULT_HOURLY_BUDGET_DIVISOR,
      fallbackNotice: publicConfig.fallback_notice ?? DEFAULT_FALLBACK_NOTICE,
      budgetNotice: publicConfig.budget_notice ?? DEFAULT_BUDGET_NOTICE,
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
      base_prompt: publicConfig.base_prompt ?? null,
      reply_debounce_seconds:
        publicConfig.reply_debounce_seconds ?? DEFAULT_REPLY_DEBOUNCE_SECONDS,
      hourly_budget_divisor: publicConfig.hourly_budget_divisor ?? DEFAULT_HOURLY_BUDGET_DIVISOR,
      fallback_notice: publicConfig.fallback_notice ?? null,
      budget_notice: publicConfig.budget_notice ?? null,
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
    const prevPublic = (row?.publicConfig ?? {}) as BotEnginePublic;
    const publicConfig = {
      provider: dto.provider,
      model: dto.model ?? null,
      // undefined = mantener el guardado; null explicito = volver al default
      base_prompt: dto.base_prompt === undefined ? (prevPublic.base_prompt ?? null) : dto.base_prompt,
      reply_debounce_seconds:
        dto.reply_debounce_seconds ?? prevPublic.reply_debounce_seconds ?? DEFAULT_REPLY_DEBOUNCE_SECONDS,
      hourly_budget_divisor:
        dto.hourly_budget_divisor ?? prevPublic.hourly_budget_divisor ?? DEFAULT_HOURLY_BUDGET_DIVISOR,
      fallback_notice:
        dto.fallback_notice === undefined ? (prevPublic.fallback_notice ?? null) : dto.fallback_notice,
      budget_notice:
        dto.budget_notice === undefined ? (prevPublic.budget_notice ?? null) : dto.budget_notice,
    };

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
