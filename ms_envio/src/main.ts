// Punto de entrada del microservicio de envios.
// Levanta la aplicacion NestJS en el puerto definido por la variable de entorno PORT (default 3000).
// El prefijo global 'api' hace que todos los endpoints queden bajo /api/...
// Swagger disponible en /api/docs para documentacion y prueba de endpoints.
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  const config = new DocumentBuilder()
    .setTitle('MS Envios')
    .setDescription('API del microservicio de envios - Smartlogix')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
