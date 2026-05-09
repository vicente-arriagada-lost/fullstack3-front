import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseInitializer } from './notificacion/database-initializer';
import { DatabasePool } from './notificacion/database-pool';
import { MensajeriaRequestValidator } from './notificacion/mensajeria-request-validator';
import { MensajeriaRepository } from './notificacion/mensajeria.repository';
import { MensajeriaService } from './notificacion/mensajeria.service';
import { NotificacionController } from './notificacion/notificacion.controller';
import { NotificacionEventsConsumer } from './notificacion/notificacion-events.consumer';
import { NotificacionRepository } from './notificacion/notificacion.repository';

@Module({
  controllers: [HealthController, NotificacionController],
  providers: [
    DatabasePool,
    DatabaseInitializer,
    NotificacionRepository,
    MensajeriaRepository,
    MensajeriaService,
    MensajeriaRequestValidator,
    NotificacionEventsConsumer,
  ],
})
export class AppModule {}
