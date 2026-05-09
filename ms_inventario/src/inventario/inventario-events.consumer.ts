import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DeleteMessageCommand, Message, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { InventarioService } from './inventario.service';
import { Pedido, PedidoEvent } from './inventario.types';

const INVENTARIO_CONSUMED_EVENTOS = new Set(['pedido_creado', 'pedido_aprobado', 'envio_rechazado', 'pedido_cancelado']);

@Injectable()
export class InventarioEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventarioEventsConsumer.name);
  private readonly sqsClient = new SQSClient({});
  private readonly queueUrl = process.env.QUEUE_URL?.trim();
  private isRunning = false;
  private poller?: Promise<void>;

  constructor(private readonly inventarioService: InventarioService) {}

  onModuleInit(): void {
    if (!this.queueUrl) {
      this.logger.warn('QUEUE_URL no esta configurado; no se consumiran eventos de inventario.');
      return;
    }

    this.isRunning = true;
    this.poller = this.pollQueue();
  }

  async onModuleDestroy(): Promise<void> {
    this.isRunning = false;
    await this.poller;
  }

  private async pollQueue(): Promise<void> {
    while (this.isRunning && this.queueUrl) {
      try {
        const response = await this.sqsClient.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
            VisibilityTimeout: 30,
          }),
        );

        for (const message of response.Messages ?? []) {
          await this.processMessage(message);
        }
      } catch (error) {
        this.logger.error('Error consumiendo mensajes desde SQS.', error);
        await this.sleep(5000);
      }
    }
  }

  private async processMessage(message: Message): Promise<void> {
    if (!this.queueUrl || !message.ReceiptHandle) {
      return;
    }

    const payload = this.parseMessageBody(message.Body);
    if (payload) {
      await this.handlePayload(payload);
    }

    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  private async handlePayload(payload: PedidoEvent): Promise<void> {
    try {
      if (payload.evento === 'pedido_creado') {
        const pedido = this.extractPedido(payload);
        if (!pedido) {
          this.logger.warn('Evento pedido_creado ignorado porque no incluye pedido valido.');
          return;
        }

        await this.inventarioService.evaluatePedidoStock(pedido);
        this.logger.log(`Stock reservado/evaluado para pedido ${pedido.id_pedido}.`);
        return;
      }

      const idPedido = this.extractIdPedido(payload);
      if (!idPedido) {
        this.logger.warn(`Evento ${payload.evento} ignorado porque no incluye id_pedido valido.`);
        return;
      }

      if (payload.evento === 'pedido_aprobado') {
        await this.inventarioService.consumePedidoAprobado(idPedido);
        this.logger.log(`Reserva consumida para pedido ${idPedido}.`);
      } else {
        await this.inventarioService.releasePedidoStock(idPedido);
        this.logger.log(`Stock liberado para pedido ${idPedido} por ${payload.evento}.`);
      }
    } catch (error) {
      this.logger.warn(`Evento ${payload.evento} no pudo aplicarse en inventario: ${(error as Error).message}`);
    }
  }

  private parseMessageBody(body: string | undefined): PedidoEvent | null {
    if (!body) {
      return null;
    }

    try {
      const parsed = JSON.parse(body) as unknown;

      if (this.isPedidoEvent(parsed)) {
        return parsed;
      }

      if (this.isSnsEnvelope(parsed)) {
        const snsMessage = JSON.parse(parsed.Message) as unknown;
        return this.isPedidoEvent(snsMessage) ? snsMessage : null;
      }
    } catch (error) {
      this.logger.warn(`Mensaje SQS ignorado por JSON invalido: ${(error as Error).message}`);
    }

    return null;
  }

  private isPedidoEvent(value: unknown): value is PedidoEvent {
    if (typeof value !== 'object' || value === null || !('evento' in value)) {
      return false;
    }

    const evento = (value as { evento?: unknown }).evento;
    return typeof evento === 'string' && INVENTARIO_CONSUMED_EVENTOS.has(evento);
  }

  private extractPedido(payload: PedidoEvent): Pedido | null {
    const pedido = payload.pedido;
    if (
      typeof pedido?.id_pedido !== 'string' ||
      !Array.isArray(pedido.productos) ||
      !pedido.productos.every(
        (producto) =>
          typeof producto?.id_producto === 'string' &&
          Number.isInteger(producto.cantidad) &&
          producto.cantidad > 0,
      )
    ) {
      return null;
    }

    return pedido;
  }

  private extractIdPedido(payload: PedidoEvent): string | null {
    const idPedido = payload.pedido?.id_pedido ?? payload.id_pedido;
    return typeof idPedido === 'string' ? idPedido : null;
  }

  private isSnsEnvelope(value: unknown): value is { Message: string } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'Message' in value &&
      typeof (value as { Message: unknown }).Message === 'string'
    );
  }

  private sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, milliseconds);
    });
  }
}
