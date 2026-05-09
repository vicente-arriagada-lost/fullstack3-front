import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DatabaseInitializer } from './pedido/database-initializer';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  const databaseInitializer = app.get(DatabaseInitializer);
  await databaseInitializer.ensureSchema();

  const port = Number(process.env.PORT || 3000);
  await app.listen(port, '0.0.0.0');
}

bootstrap().catch((error: unknown) => {
  console.error('ms_pedido failed to start', error);
  process.exit(1);
});
