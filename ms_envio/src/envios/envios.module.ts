import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Envio } from './envio.entity';
import { EnviosService } from './envios.service';
import { EnviosController } from './envios.controller';
import { EnvioEventPublisher } from './envio-event-publisher';
import { EnvioEventsConsumer } from './envio-events.consumer';

@Module({
  imports: [TypeOrmModule.forFeature([Envio])],
  controllers: [EnviosController],
  providers: [EnviosService, EnvioEventPublisher, EnvioEventsConsumer],
})
export class EnviosModule {}
