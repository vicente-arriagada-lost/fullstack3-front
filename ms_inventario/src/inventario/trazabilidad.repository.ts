import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabasePool } from './database-pool';
import { getInventarioTrazabilidadTableName } from './database-schema';
import { TrazabilidadInventario } from './inventario.types';

@Injectable()
export class TrazabilidadRepository {
  private readonly tableName = getInventarioTrazabilidadTableName();

  constructor(private readonly databasePool: DatabasePool) {}

  async create(idProducto: string, nombreResponsable: string): Promise<TrazabilidadInventario> {
    const result = await this.databasePool.query<TrazabilidadInventario>(
      `
        INSERT INTO ${this.tableName} (id_trazabilidad, fecha_hora, id_producto, nombre_responsable)
        VALUES ($1, NOW(), $2, $3)
        RETURNING id_trazabilidad, fecha_hora, id_producto, nombre_responsable
      `,
      [randomUUID(), idProducto, nombreResponsable],
    );

    return result.rows[0] as TrazabilidadInventario;
  }
}
