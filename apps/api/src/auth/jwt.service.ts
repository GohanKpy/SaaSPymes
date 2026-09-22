import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AccessTokenClaims, Env } from '@pymes/shared';
import { SignJWT, importPKCS8, importSPKI, jwtVerify, type KeyLike } from 'jose';

import { ENV } from '../env.module';

const ALG = 'RS256';
const ACCESS_TTL = '15m'; // doc 05 §3

@Injectable()
export class JwtSigner {
  private privateKey?: KeyLike;
  private publicKey?: KeyLike;

  constructor(@Inject(ENV) private readonly env: Env) {}

  private async keys(): Promise<{ priv: KeyLike; pub: KeyLike }> {
    this.privateKey ??= await importPKCS8(
      Buffer.from(this.env.JWT_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
      ALG,
    );
    this.publicKey ??= await importSPKI(
      Buffer.from(this.env.JWT_PUBLIC_KEY_BASE64, 'base64').toString('utf8'),
      ALG,
    );
    return { priv: this.privateKey, pub: this.publicKey };
  }

  /** ttl: solo las sesiones de soporte (2026-09-22) usan una vida distinta (60 min, sin refresh). */
  async signAccess(claims: Omit<AccessTokenClaims, 'jti'>, ttl: string = ACCESS_TTL): Promise<string> {
    const { priv } = await this.keys();
    return new SignJWT({ ...claims, jti: randomUUID() })
      .setProtectedHeader({ alg: ALG })
      .setIssuedAt()
      .setExpirationTime(ttl)
      .sign(priv);
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const { pub } = await this.keys();
    const { payload } = await jwtVerify(token, pub, { algorithms: [ALG] });
    return payload as unknown as AccessTokenClaims;
  }
}
