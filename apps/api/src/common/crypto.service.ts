import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '@pymes/shared';

import { ENV } from '../env.module';

/**
 * CryptoService (doc 05 §4.2): cifra credenciales de integraciones antes de
 * persistirlas. Implementacion local AES-256-GCM; la variante KMS (envelope
 * encryption) llega con el pase a AWS — misma interfaz, otro proveedor.
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(@Inject(ENV) env: Env) {
    if (env.CRYPTO_PROVIDER !== 'local') {
      throw new Error('CryptoService: proveedor kms pendiente (llega con AWS)');
    }
    this.key = Buffer.from(env.CRYPTO_LOCAL_KEY_BASE64 ?? '', 'base64');
    if (this.key.length !== 32) {
      throw new Error('CRYPTO_LOCAL_KEY_BASE64 debe ser 32 bytes en base64');
    }
  }

  encryptJson(payload: unknown): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    return new Uint8Array(Buffer.concat([iv, cipher.getAuthTag(), ciphertext])) as Uint8Array<ArrayBuffer>;
  }

  decryptJson<T>(blob: Uint8Array): T {
    const buf = Buffer.from(blob);
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plain.toString('utf8')) as T;
  }
}
