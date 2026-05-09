// Modulo raiz de la aplicacion.
// Carga las variables de entorno con ConfigModule y conecta a PostgreSQL usando TypeORM.
// DATABASE_URL y DATABASE_SSL son inyectadas por ECS desde SSM Parameter Store.
// synchronize solo esta activo fuera del entorno 'main' para no alterar la BD en produccion.
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EnviosModule } from './envios/envios.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: process.env.NODE_ENV !== 'main',
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
    }),
    EnviosModule,
  ],
})
export class AppModule {}
