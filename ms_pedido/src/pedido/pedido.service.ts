import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PedidoEventPublisher } from './pedido-event-publisher';
import { PedidoRequestValidator } from './pedido-request-validator';
import { PedidoRepository } from './pedido.repository';
import {
  CreatePedidoRequest,
  Pedido,
  PedidoConTrazabilidad,
  PedidoStatus,
  UpdatePedidoRequest,
} from './pedido.types';

type PedidoRepositoryPort = Pick<
  PedidoRepository,
  'create' | 'update' | 'cancel' | 'approve' | 'reject' | 'finalize' | 'findStatusById'
>;
type PedidoEventPublisherPort = Pick<
  PedidoEventPublisher,
  | 'publishPedidoCreado'
  | 'publishPedidoActualizado'
  | 'publishPedidoCancelado'
  | 'publishPedidoAprobado'
  | 'publishPedidoFinalizado'
>;

@Injectable()
export class PedidoService {
  constructor(
    @Inject(PedidoRepository) private readonly pedidoRepository: PedidoRepositoryPort,
    @Inject(PedidoEventPublisher) private readonly pedidoEventPublisher: PedidoEventPublisherPort,
    private readonly pedidoRequestValidator: PedidoRequestValidator,
  ) {}

  async create(body: CreatePedidoRequest = {}): Promise<PedidoConTrazabilidad> {
    const createPedidoData = this.pedidoRequestValidator.validateCreateRequest(
      body,
      randomUUID(),
      new Date(),
    );
    const createdPedido = await this.pedidoRepository.create(createPedidoData);
    await this.pedidoEventPublisher.publishPedidoCreado(createdPedido);

    return createdPedido;
  }

  async update(idPedido: string, body: UpdatePedidoRequest = {}): Promise<Pedido> {
    this.pedidoRequestValidator.validateIdPedido(idPedido);
    const fields = this.pedidoRequestValidator.validateUpdateRequest(body);

    const pedido = await this.pedidoRepository.update(idPedido, fields);
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado.');
    }

    await this.pedidoEventPublisher.publishPedidoActualizado(pedido);

    return pedido;
  }

  async cancel(idPedido: string): Promise<Pedido> {
    this.pedidoRequestValidator.validateIdPedido(idPedido);

    await this.ensurePedidoCanTransition(idPedido, ['creado'], 'Solo se puede cancelar un pedido en estado creado.');
    const pedido = await this.pedidoRepository.cancel(idPedido);
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado.');
    }

    await this.pedidoEventPublisher.publishPedidoCancelado(pedido);

    return pedido;
  }

  async approveFromStock(idPedido: string): Promise<Pedido> {
    this.pedidoRequestValidator.validateIdPedido(idPedido);
    await this.ensurePedidoCanTransition(idPedido, ['creado'], 'Solo se puede aprobar un pedido en estado creado.');

    const pedido = await this.pedidoRepository.approve(idPedido);
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado.');
    }

    await this.pedidoEventPublisher.publishPedidoAprobado(pedido);

    return pedido;
  }

  async rejectFromStock(idPedido: string): Promise<Pedido> {
    this.pedidoRequestValidator.validateIdPedido(idPedido);
    await this.ensurePedidoCanTransition(idPedido, ['creado'], 'Solo se puede rechazar un pedido en estado creado.');

    const pedido = await this.pedidoRepository.reject(idPedido);
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado.');
    }

    return pedido;
  }

  async finalizeFromEnvio(idPedido: string): Promise<Pedido> {
    this.pedidoRequestValidator.validateIdPedido(idPedido);
    await this.ensurePedidoCanTransition(idPedido, ['aprobado'], 'Solo se puede finalizar un pedido aprobado.');

    const pedido = await this.pedidoRepository.finalize(idPedido);
    if (!pedido) {
      throw new NotFoundException('Pedido no encontrado.');
    }

    await this.pedidoEventPublisher.publishPedidoFinalizado(pedido);

    return pedido;
  }

  async getStatus(idPedido: string): Promise<PedidoStatus> {
    this.pedidoRequestValidator.validateIdPedido(idPedido);

    const pedidoStatus = await this.pedidoRepository.findStatusById(idPedido);
    if (!pedidoStatus) {
      throw new NotFoundException('Pedido no encontrado.');
    }

    return pedidoStatus;
  }

  private async ensurePedidoCanTransition(
    idPedido: string,
    allowedStates: Pedido['estado'][],
    conflictMessage: string,
  ): Promise<void> {
    const pedidoStatus = await this.pedidoRepository.findStatusById(idPedido);
    if (!pedidoStatus) {
      throw new NotFoundException('Pedido no encontrado.');
    }

    if (!allowedStates.includes(pedidoStatus.estado)) {
      throw new ConflictException(conflictMessage);
    }
  }
}
