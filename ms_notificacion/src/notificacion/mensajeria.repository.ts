import { Injectable } from '@nestjs/common';
import { getMensajeriaTableName } from './database-schema';
import { DatabasePool } from './database-pool';
import {
  CreateMensajeriaData,
  Mensajeria,
  MensajeriaUpdateFields,
} from './notificacion.types';

@Injectable()
export class MensajeriaRepository {
  private readonly mensajeriaTableName: string;

  constructor(private readonly databasePool: DatabasePool) {
    this.mensajeriaTableName = getMensajeriaTableName();
  }

  async create(mensaje: CreateMensajeriaData): Promise<Mensajeria> {
    const result = await this.databasePool.query<Mensajeria>(
      `
        INSERT INTO ${this.mensajeriaTableName}
          (id_mensaje, asunto, cuerpo, responsable, fecha_envio, destinatarios)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id_mensaje, asunto, cuerpo, responsable, fecha_envio, destinatarios
      `,
      [
        mensaje.id_mensaje,
        mensaje.asunto,
        mensaje.cuerpo,
        mensaje.responsable,
        mensaje.fecha_envio,
        mensaje.destinatarios,
      ],
    );

    return result.rows[0] as Mensajeria;
  }

  async findById(idMensaje: string): Promise<Mensajeria | null> {
    const result = await this.databasePool.query<Mensajeria>(
      `
        SELECT id_mensaje, asunto, cuerpo, responsable, fecha_envio, destinatarios
        FROM ${this.mensajeriaTableName}
        WHERE id_mensaje = $1
      `,
      [idMensaje],
    );

    return result.rows[0] ?? null;
  }

  async update(idMensaje: string, fields: MensajeriaUpdateFields): Promise<Mensajeria | null> {
    const assignments: string[] = [];
    const values: unknown[] = [];

    this.addAssignment(assignments, values, fields, 'asunto');
    this.addAssignment(assignments, values, fields, 'cuerpo');
    this.addAssignment(assignments, values, fields, 'responsable');
    this.addAssignment(assignments, values, fields, 'fecha_envio');
    this.addAssignment(assignments, values, fields, 'destinatarios');

    values.push(idMensaje);

    const result = await this.databasePool.query<Mensajeria>(
      `
        UPDATE ${this.mensajeriaTableName}
        SET ${assignments.join(', ')}
        WHERE id_mensaje = $${values.length}
        RETURNING id_mensaje, asunto, cuerpo, responsable, fecha_envio, destinatarios
      `,
      values,
    );

    return result.rows[0] ?? null;
  }

  async delete(idMensaje: string): Promise<Mensajeria | null> {
    const result = await this.databasePool.query<Mensajeria>(
      `
        DELETE FROM ${this.mensajeriaTableName}
        WHERE id_mensaje = $1
        RETURNING id_mensaje, asunto, cuerpo, responsable, fecha_envio, destinatarios
      `,
      [idMensaje],
    );

    return result.rows[0] ?? null;
  }

  private addAssignment<K extends keyof MensajeriaUpdateFields>(
    assignments: string[],
    values: unknown[],
    fields: MensajeriaUpdateFields,
    fieldName: K,
  ): void {
    if (fields[fieldName] === undefined) {
      return;
    }

    values.push(fields[fieldName]);
    assignments.push(`${fieldName} = $${values.length}`);
  }
}
