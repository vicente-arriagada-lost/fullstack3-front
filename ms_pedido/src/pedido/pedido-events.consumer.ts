import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DeleteMessageCommand, Message, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { EnvioFinalizadoEvent, StockEvaluadoEvent } from './pedido.types';
import { PedidoService } from './pedido.service';

type PedidoEventPayload = StockEvaluadoEvent | EnvioFinalizadoEvent;

const PEDIDO_CONSUMED_EVENTOS = new Set(['stock_aprobado', 'stock_rechazado', 'envio_finalizado']);

@Injectable()
export class PedidoEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PedidoEventsConsumer.name);
  private readonly sqsClient = new SQSClient({});
  private readonly queueUrl = process.env.QUEUE_URL?.trim();
  private isRunning = false;
  private poller?: Promise<void>;

  constructor(private readonly pedidoService: PedidoService) {}

  onModuleInit(): void {
    if (!this.queueUrl) {
      this.logger.warn('QUEUE_URL no esta configurado; no se consumiran eventos de pedidos.');
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

  private async handlePayload(payload: PedidoEventPayload): Promise<void> {
    const idPedido = this.extractIdPedido(payload);
    if (!idPedido) {
      this.logger.warn(`Evento ${payload.evento} ignorado porque no incluye id_pedido valido.`);
      return;
    }

    try {
      if (payload.evento === 'stock_aprobado') {
        await this.pedidoService.approveFromStock(idPedido);
        this.logger.log(`Pedido ${idPedido} aprobado por stock_aprobado.`);
      } else if (payload.evento === 'stock_rechazado') {
        await this.pedidoService.rejectFromStock(idPedido);
        this.logger.log(`Pedido ${idPedido} rechazado por stock_rechazado.`);
      } else if (payload.evento === 'envio_finalizado') {
        await this.pedidoService.finalizeFromEnvio(idPedido);
        this.logger.log(`Pedido ${idPedido} finalizado por envio_finalizado.`);
      }
    } catch (error) {
      this.logger.warn(`Evento ${payload.evento} no pudo aplicarse al pedido ${idPedido}: ${(error as Error).message}`);
    }
  }

  private parseMessageBody(body: string | undefined): PedidoEventPayload | null {
    if (!body) {
      return null;
    }

    try {
      const parsed = JSON.parse(body) as unknown;

      if (this.isPedidoEventPayload(parsed)) {
        return parsed;
      }

      if (this.isSnsEnvelope(parsed)) {
        const snsMessage = JSON.parse(parsed.Message) as unknown;
        return this.isPedidoEventPayload(snsMessage) ? snsMessage : null;
      }
    } catch (error) {
      this.logger.warn(`Mensaje SQS ignorado por JSON invalido: ${(error as Error).message}`);
    }

    return null;
  }

  private isPedidoEventPayload(value: unknown): value is PedidoEventPayload {
    if (typeof value !== 'object' || value === null || !('evento' in value)) {
      return false;
    }

    const evento = (value as { evento?: unknown }).evento;
    return typeof evento === 'string' && PEDIDO_CONSUMED_EVENTOS.has(evento);
  }

  private extractIdPedido(payload: PedidoEventPayload): string | null {
    const idPedido = payload.evento === 'envio_finalizado' ? payload.pedido?.id_pedido ?? payload.id_pedido : payload.pedido.id_pedido;
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
