import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseInitializer } from './pedido/database-initializer';
import { DatabasePool } from './pedido/database-pool';
import { PedidoController } from './pedido/pedido.controller';
import { PedidoEventPublisher } from './pedido/pedido-event-publisher';
import { PedidoEventsConsumer } from './pedido/pedido-events.consumer';
import { PedidoRequestValidator } from './pedido/pedido-request-validator';
import { PedidoRepository } from './pedido/pedido.repository';
import { PedidoService } from './pedido/pedido.service';

@Module({
  controllers: [HealthController, PedidoController],
  providers: [
    DatabasePool,
    DatabaseInitializer,
    PedidoRepository,
    PedidoEventPublisher,
    PedidoEventsConsumer,
    PedidoRequestValidator,
    PedidoService,
  ],
})
export class AppModule {}
