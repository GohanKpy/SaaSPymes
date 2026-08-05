import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { loginRequest, type Env, type LoginRequest, type LoginResponse } from '@pymes/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { RateLimit, RateLimitGuard } from '../common/rate-limit.guard';
import { ZodPipe } from '../common/zod.pipe';
import { ENV } from '../env.module';
import { Inject } from '@nestjs/common';
import { Public } from './decorators';
import { AuthService, type IssuedSession } from './auth.service';

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private setRefreshCookie(reply: FastifyReply, session: IssuedSession): void {
    // httpOnly + SameSite=Strict: el refresh jamas es accesible por JS (doc 05 §3).
    void reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.env.NODE_ENV === 'production',
      path: COOKIE_PATH,
      maxAge: 30 * 24 * 3600,
    });
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 300) // 20 intentos por IP cada 5 min (ademas del lockout por cuenta)
  async login(
    @Body(new ZodPipe(loginRequest)) dto: LoginRequest,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    const { session, response } = await this.auth.login(dto, req.ip, req.headers['user-agent']);
    if (session) this.setRefreshCookie(reply, session);
    return response;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit(120, 300)
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<LoginResponse> {
    // Unico endpoint autenticado por cookie: exige header custom anti-CSRF
    // ademas de SameSite=Strict (doc 05 §5).
    if (!req.headers['x-requested-with']) {
      throw new BadRequestException({ title: 'Falta X-Requested-With' });
    }
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthorizedException();
    const session = await this.auth.refresh(raw, req.ip, req.headers['user-agent']);
    this.setRefreshCookie(reply, session);
    return { access_token: session.accessToken, user: session.user };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) await this.auth.logout(raw);
    void reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }
}
