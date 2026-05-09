import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { DatabasePool } from './database-pool';
import { getNotificacionTableName } from './database-schema';
import { NOTIFICACION_MENSAJES, Notificacion, NotificacionTipo } from './notificacion.types';

@Injectable()
export class NotificacionRepository {
  private readonly notificacionTableName: string;

  constructor(private readonly databasePool: DatabasePool) {
    this.notificacionTableName = getNotificacionTableName();
  }

  async createFromEvent(tipoNotificacion: NotificacionTipo, idPedido: string | null): Promise<Notificacion> {
    const result = await this.databasePool.query<Notificacion>(
      `
        INSERT INTO ${this.notificacionTableName} (id_notificacion, id_pedido, tipo_notificacion, mensaje)
        VALUES ($1, $2, $3, $4)
        RETURNING id_notificacion, id_pedido, tipo_notificacion, fecha, mensaje, status
      `,
      [randomUUID(), idPedido, tipoNotificacion, NOTIFICACION_MENSAJES[tipoNotificacion]],
    );

    return result.rows[0] as Notificacion;
  }
}
