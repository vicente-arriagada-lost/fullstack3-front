import { Injectable } from '@nestjs/common';
import { DatabasePool } from './database-pool';
import {
  getDatabaseSchema,
  getMensajeriaTableName,
  getNotificacionTableName,
  getPedidosTableName,
  quoteIdentifier,
} from './database-schema';

@Injectable()
export class DatabaseInitializer {
  constructor(private readonly databasePool: DatabasePool) {}

  async ensureSchema(): Promise<void> {
    const schema = getDatabaseSchema();
    const notificacionTableName = getNotificacionTableName();
    const pedidosTableName = getPedidosTableName();
    const mensajeriaTableName = getMensajeriaTableName();

    await this.databasePool.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
    await this.databasePool.query(`
      CREATE TABLE IF NOT EXISTS ${notificacionTableName} (
        id_notificacion UUID PRIMARY KEY,
        id_pedido UUID,
        tipo_notificacion VARCHAR(40) NOT NULL DEFAULT 'pedido_finalizado' CHECK (
          tipo_notificacion IN ('envio_aprobado', 'envio_rechazado', 'envio_atrasado', 'pedido_finalizado')
        ),
        fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        mensaje TEXT NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'sin entregar' CHECK (
          status IN ('entregado', 'sin entregar', 'esperando revision')
        )
      )
    `);
    await this.databasePool.query(`
      ALTER TABLE ${notificacionTableName}
      ADD COLUMN IF NOT EXISTS id_pedido UUID
    `);
    await this.databasePool.query(`
      ALTER TABLE ${notificacionTableName}
      ADD COLUMN IF NOT EXISTS tipo_notificacion VARCHAR(40) NOT NULL DEFAULT 'pedido_finalizado'
    `);
    await this.databasePool.query(`
      ALTER TABLE ${notificacionTableName}
      DROP CONSTRAINT IF EXISTS notificacion_id_pedido_required
    `);
    await this.databasePool.query(`
      ALTER TABLE ${notificacionTableName}
      DROP CONSTRAINT IF EXISTS notificacion_tipo_notificacion_check
    `);
    await this.databasePool.query(`
      ALTER TABLE ${notificacionTableName}
      ADD CONSTRAINT notificacion_tipo_notificacion_check
      CHECK (tipo_notificacion IN ('envio_aprobado', 'envio_rechazado', 'envio_atrasado', 'pedido_finalizado'))
    `);
    await this.databasePool.query(`
      DO $$
      BEGIN
        IF to_regclass('${pedidosTableName}') IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'notificacion_id_pedido_fkey'
              AND conrelid = '${notificacionTableName}'::regclass
          )
        THEN
          ALTER TABLE ${notificacionTableName}
          ADD CONSTRAINT notificacion_id_pedido_fkey
          FOREIGN KEY (id_pedido) REFERENCES ${pedidosTableName}(id_pedido);
        END IF;
      END $$;
    `);
    await this.databasePool.query(`
      CREATE TABLE IF NOT EXISTS ${mensajeriaTableName} (
        id_mensaje UUID PRIMARY KEY,
        asunto TEXT NOT NULL,
        cuerpo TEXT NOT NULL,
        responsable TEXT NOT NULL,
        fecha_envio TIMESTAMPTZ NOT NULL,
        destinatarios TEXT[] NOT NULL CHECK (array_length(destinatarios, 1) > 0)
      )
    `);
  }
}
