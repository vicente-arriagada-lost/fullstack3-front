import { Injectable } from '@nestjs/common';
import { DatabasePool } from './database-pool';
import {
  getDatabaseSchema,
  getPedidosTableName,
  getTrazabilidadPedidoTableName,
  quoteIdentifier,
} from './database-schema';

@Injectable()
export class DatabaseInitializer {
  constructor(private readonly databasePool: DatabasePool) {}

  async ensureSchema(): Promise<void> {
    const schema = getDatabaseSchema();
    const pedidosTableName = getPedidosTableName();
    const trazabilidadPedidoTableName = getTrazabilidadPedidoTableName();

    await this.databasePool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
    await this.databasePool.query(`
      CREATE TABLE IF NOT EXISTS ${pedidosTableName} (
        id_pedido UUID PRIMARY KEY,
        productos JSONB NOT NULL,
        direccion_despacho TEXT NOT NULL,
        estado VARCHAR(20) NOT NULL CHECK (estado IN ('creado', 'aprobado', 'rechazado', 'cancelado', 'finalizado')),
        fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.databasePool.query(`
      ALTER TABLE ${pedidosTableName}
      ADD COLUMN IF NOT EXISTS fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
    `);
    await this.databasePool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conrelid = '${pedidosTableName}'::regclass
            AND conname = 'pedidos_estado_check'
        ) THEN
          ALTER TABLE ${pedidosTableName} DROP CONSTRAINT pedidos_estado_check;
        END IF;

        ALTER TABLE ${pedidosTableName}
        ADD CONSTRAINT pedidos_estado_check
        CHECK (estado IN ('creado', 'aprobado', 'rechazado', 'cancelado', 'finalizado'));
      END $$;
    `);
    await this.databasePool.query(`
      CREATE TABLE IF NOT EXISTS ${trazabilidadPedidoTableName} (
        id_pedido UUID PRIMARY KEY REFERENCES ${pedidosTableName}(id_pedido) ON DELETE CASCADE,
        nombre_solicitante TEXT NOT NULL,
        tipo_cargo TEXT NOT NULL,
        empresa TEXT NOT NULL
      )
    `);
  }
}
