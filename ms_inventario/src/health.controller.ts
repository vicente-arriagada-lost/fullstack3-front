import { Controller, Get } from '@nestjs/common';

interface HealthResponse {
  status: 'ok';
}

@Controller()
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}
