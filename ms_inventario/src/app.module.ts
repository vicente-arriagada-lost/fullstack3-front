import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DatabaseInitializer } from './inventario/database-initializer';
import { DatabasePool } from './inventario/database-pool';
import { InventarioController } from './inventario/inventario.controller';
import { InventarioEventPublisher } from './inventario/inventario-event-publisher';
import { InventarioRequestValidator } from './inventario/inventario-request-validator';
import { InventarioRepository } from './inventario/inventario.repository';
import { InventarioService } from './inventario/inventario.service';
import { MongoDatabase } from './inventario/mongo-database';
import { InventarioEventsConsumer } from './inventario/inventario-events.consumer';
import { TrazabilidadRepository } from './inventario/trazabilidad.repository';

@Module({
  controllers: [HealthController, InventarioController],
  providers: [
    DatabasePool,
    MongoDatabase,
    DatabaseInitializer,
    InventarioRepository,
    TrazabilidadRepository,
    InventarioEventPublisher,
    InventarioRequestValidator,
    InventarioService,
    InventarioEventsConsumer,
  ],
})
export class AppModule {}
