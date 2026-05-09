import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MensajeriaRequestValidator } from './mensajeria-request-validator';
import { MensajeriaRepository } from './mensajeria.repository';
import {
  CreateMensajeriaRequest,
  Mensajeria,
  UpdateMensajeriaRequest,
} from './notificacion.types';

type MensajeriaRepositoryPort = Pick<MensajeriaRepository, 'create' | 'findById' | 'update' | 'delete'>;

@Injectable()
export class MensajeriaService {
  constructor(
    @Inject(MensajeriaRepository) private readonly mensajeriaRepository: MensajeriaRepositoryPort,
    private readonly mensajeriaRequestValidator: MensajeriaRequestValidator,
  ) {}

  create(body: CreateMensajeriaRequest = {}): Promise<Mensajeria> {
    const mensaje = this.mensajeriaRequestValidator.validateCreateRequest(body, randomUUID());
    return this.mensajeriaRepository.create(mensaje);
  }

  async getById(idMensaje: string): Promise<Mensajeria> {
    this.mensajeriaRequestValidator.validateIdMensaje(idMensaje);

    const mensaje = await this.mensajeriaRepository.findById(idMensaje);
    if (!mensaje) {
      throw new NotFoundException('Mensaje no encontrado.');
    }

    return mensaje;
  }

  async update(idMensaje: string, body: UpdateMensajeriaRequest = {}): Promise<Mensajeria> {
    this.mensajeriaRequestValidator.validateIdMensaje(idMensaje);
    const fields = this.mensajeriaRequestValidator.validateUpdateRequest(body);

    const mensaje = await this.mensajeriaRepository.update(idMensaje, fields);
    if (!mensaje) {
      throw new NotFoundException('Mensaje no encontrado.');
    }

    return mensaje;
  }

  async delete(idMensaje: string): Promise<Mensajeria> {
    this.mensajeriaRequestValidator.validateIdMensaje(idMensaje);

    const mensaje = await this.mensajeriaRepository.delete(idMensaje);
    if (!mensaje) {
      throw new NotFoundException('Mensaje no encontrado.');
    }

    return mensaje;
  }
}
