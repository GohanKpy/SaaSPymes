import { Controller, Get } from '@nestjs/common';

import { Public } from './auth/decorators';

@Controller('health')
@Public()
export class HealthController {
  @Get()
  health(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
