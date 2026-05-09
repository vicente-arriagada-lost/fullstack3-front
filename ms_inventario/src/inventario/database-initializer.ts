import { Injectable } from '@nestjs/common';
import { DatabasePool } from './database-pool';
import { getDatabaseSchema, getInventarioTrazabilidadTableName, quoteIdentifier } from './database-schema';
import { MongoDatabase } from './mongo-database';

@Injectable()
export class DatabaseInitializer {
  constructor(
    private readonly databasePool: DatabasePool,
    private readonly mongoDatabase: MongoDatabase,
  ) {}

  async ensureSchema(): Promise<void> {
    const schema = getDatabaseSchema();
    const trazabilidadTableName = getInventarioTrazabilidadTableName();

    await this.databasePool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
    await this.databasePool.query(`
      CREATE TABLE IF NOT EXISTS ${trazabilidadTableName} (
        id_trazabilidad UUID PRIMARY KEY,
        fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        id_producto TEXT NOT NULL,
        nombre_responsable TEXT NOT NULL
      )
    `);
    await this.databasePool.query(`
      CREATE INDEX IF NOT EXISTS idx_inventario_trazabilidad_id_producto
      ON ${trazabilidadTableName} (id_producto)
    `);

    const collection = await this.mongoDatabase.getInventarioCollection();
    await collection.createIndex({ id_producto: 1 }, { unique: true, name: 'uidx_inventario_id_producto' });
    await collection.createIndex({ tipo: 1, activo: 1 }, { name: 'idx_inventario_tipo_activo' });

    const reservasCollection = await this.mongoDatabase.getReservasCollection();
    await reservasCollection.createIndex({ id_pedido: 1 }, { unique: true, name: 'uidx_inventario_reservas_id_pedido' });
    await reservasCollection.createIndex({ estado: 1 }, { name: 'idx_inventario_reservas_estado' });
  }
}
