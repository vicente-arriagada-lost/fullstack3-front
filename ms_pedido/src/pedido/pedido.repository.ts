import { Injectable } from '@nestjs/common';
import { DatabaseClient, DatabasePool } from './database-pool';
import { getPedidosTableName, getTrazabilidadPedidoTableName } from './database-schema';
import {
  CreatePedidoData,
  Pedido,
  PedidoConTrazabilidad,
  PedidoStatus,
  PedidoUpdateFields,
} from './pedido.types';

@Injectable()
export class PedidoRepository {
  private readonly pedidosTableName: string;
  private readonly trazabilidadPedidoTableName: string;

  constructor(private readonly databasePool: DatabasePool) {
    this.pedidosTableName = getPedidosTableName();
    this.trazabilidadPedidoTableName = getTrazabilidadPedidoTableName();
  }

  async create(createPedidoData: CreatePedidoData): Promise<PedidoConTrazabilidad> {
    return this.databasePool.transaction(async (client) => {
      const pedido = await this.insertPedido(client, createPedidoData.pedido);
      const trazabilidadPedido = await this.insertTrazabilidadPedido(
        client,
        createPedidoData.trazabilidadPedido,
      );

      return {
        ...pedido,
        trazabilidad_pedido: {
          nombre_solicitante: trazabilidadPedido.nombre_solicitante,
          tipo_cargo: trazabilidadPedido.tipo_cargo,
          empresa: trazabilidadPedido.empresa,
        },
      };
    });
  }

  private async insertPedido(client: DatabaseClient, pedido: Pedido): Promise<Pedido> {
    const result = await client.query<Pedido>(
      `
        INSERT INTO ${this.pedidosTableName} (id_pedido, productos, direccion_despacho, estado, fecha_hora)
        VALUES ($1, $2::jsonb, $3, $4, $5)
        RETURNING id_pedido, productos, direccion_despacho, estado, fecha_hora
      `,
      [
        pedido.id_pedido,
        JSON.stringify(pedido.productos),
        pedido.direccion_despacho,
        pedido.estado,
        pedido.fecha_hora,
      ],
    );

    return result.rows[0] as Pedido;
  }

  private async insertTrazabilidadPedido(
    client: DatabaseClient,
    trazabilidadPedido: CreatePedidoData['trazabilidadPedido'],
  ): Promise<CreatePedidoData['trazabilidadPedido']> {
    const result = await client.query<CreatePedidoData['trazabilidadPedido']>(
      `
        INSERT INTO ${this.trazabilidadPedidoTableName} (id_pedido, nombre_solicitante, tipo_cargo, empresa)
        VALUES ($1, $2, $3, $4)
        RETURNING id_pedido, nombre_solicitante, tipo_cargo, empresa
      `,
      [
        trazabilidadPedido.id_pedido,
        trazabilidadPedido.nombre_solicitante,
        trazabilidadPedido.tipo_cargo,
        trazabilidadPedido.empresa,
      ],
    );

    return result.rows[0] as CreatePedidoData['trazabilidadPedido'];
  }

  async update(idPedido: string, fields: PedidoUpdateFields): Promise<Pedido | null> {
    const result = await this.databasePool.query<Pedido>(
      `
        UPDATE ${this.pedidosTableName}
        SET direccion_despacho = $1
        WHERE id_pedido = $2
        RETURNING id_pedido, productos, direccion_despacho, estado, fecha_hora
      `,
      [fields.direccion_despacho, idPedido],
    );

    return result.rows[0] ?? null;
  }

  async cancel(idPedido: string): Promise<Pedido | null> {
    const result = await this.databasePool.query<Pedido>(
      `
        UPDATE ${this.pedidosTableName}
        SET estado = 'cancelado'
        WHERE id_pedido = $1 AND estado = 'creado'
        RETURNING id_pedido, productos, direccion_despacho, estado, fecha_hora
      `,
      [idPedido],
    );

    return result.rows[0] ?? null;
  }

  async approve(idPedido: string): Promise<Pedido | null> {
    return this.updateEstado(idPedido, 'aprobado', 'creado');
  }

  async reject(idPedido: string): Promise<Pedido | null> {
    return this.updateEstado(idPedido, 'rechazado', 'creado');
  }

  async finalize(idPedido: string): Promise<Pedido | null> {
    return this.updateEstado(idPedido, 'finalizado', 'aprobado');
  }

  async findStatusById(idPedido: string): Promise<PedidoStatus | null> {
    const result = await this.databasePool.query<PedidoStatus>(
      `SELECT id_pedido, estado FROM ${this.pedidosTableName} WHERE id_pedido = $1`,
      [idPedido],
    );

    return result.rows[0] ?? null;
  }

  private async updateEstado(
    idPedido: string,
    nextEstado: Pedido['estado'],
    currentEstado: Pedido['estado'],
  ): Promise<Pedido | null> {
    const result = await this.databasePool.query<Pedido>(
      `
        UPDATE ${this.pedidosTableName}
        SET estado = $1
        WHERE id_pedido = $2 AND estado = $3
        RETURNING id_pedido, productos, direccion_despacho, estado, fecha_hora
      `,
      [nextEstado, idPedido, currentEstado],
    );

    return result.rows[0] ?? null;
  }
}
