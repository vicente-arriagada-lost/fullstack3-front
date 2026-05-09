import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CreateMensajeriaData,
  CreateMensajeriaRequest,
  MensajeriaUpdateFields,
  UpdateMensajeriaRequest,
} from './notificacion.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class MensajeriaRequestValidator {
  validateCreateRequest(body: CreateMensajeriaRequest, idMensaje: string): CreateMensajeriaData {
    return {
      id_mensaje: idMensaje,
      asunto: this.validateRequiredText(body.asunto, 'asunto'),
      cuerpo: this.validateRequiredText(body.cuerpo, 'cuerpo'),
      responsable: this.validateRequiredText(body.responsable, 'responsable'),
      fecha_envio: this.validateFechaEnvio(body.fecha_envio),
      destinatarios: this.validateDestinatarios(body.destinatarios),
    };
  }

  validateUpdateRequest(body: UpdateMensajeriaRequest): MensajeriaUpdateFields {
    const fields: MensajeriaUpdateFields = {};

    if (body.asunto !== undefined) {
      fields.asunto = this.validateRequiredText(body.asunto, 'asunto');
    }

    if (body.cuerpo !== undefined) {
      fields.cuerpo = this.validateRequiredText(body.cuerpo, 'cuerpo');
    }

    if (body.responsable !== undefined) {
      fields.responsable = this.validateRequiredText(body.responsable, 'responsable');
    }

    if (body.fecha_envio !== undefined) {
      fields.fecha_envio = this.validateFechaEnvio(body.fecha_envio);
    }

    if (body.destinatarios !== undefined) {
      fields.destinatarios = this.validateDestinatarios(body.destinatarios);
    }

    if (Object.keys(fields).length === 0) {
      throw new BadRequestException('Debe indicar al menos un campo para modificar.');
    }

    return fields;
  }

  validateIdMensaje(idMensaje: string): void {
    if (!UUID_PATTERN.test(idMensaje)) {
      throw new BadRequestException('id_mensaje debe ser un UUID valido.');
    }
  }

  private validateRequiredText(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(`${fieldName} debe ser un texto no vacio.`);
    }

    return value.trim();
  }

  private validateFechaEnvio(value: unknown): Date {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException('fecha_envio debe ser una fecha ISO valida.');
    }

    const fechaEnvio = new Date(value);
    if (Number.isNaN(fechaEnvio.getTime())) {
      throw new BadRequestException('fecha_envio debe ser una fecha ISO valida.');
    }

    return fechaEnvio;
  }

  private validateDestinatarios(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new BadRequestException('destinatarios debe ser un arreglo no vacio de correos.');
    }

    return value.map((destinatario, index) => this.validateEmail(destinatario, index));
  }

  private validateEmail(value: unknown, index: number): string {
    const email = this.validateRequiredText(value, `destinatarios[${index}]`).toLowerCase();

    if (!EMAIL_PATTERN.test(email)) {
      throw new BadRequestException(`destinatarios[${index}] debe ser un correo valido.`);
    }

    return email;
  }
}
