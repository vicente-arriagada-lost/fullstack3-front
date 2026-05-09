import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DeleteMessageCommand, Message, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { NotificacionRepository } from './notificacion.repository';
import { NOTIFICACION_EVENTOS, NotificacionEventPayload, NotificacionTipo } from './notificacion.types';

const NOTIFICACION_CONSUMED_EVENTOS = new Set<string>(Object.values(NOTIFICACION_EVENTOS));

@Injectable()
export class NotificacionEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificacionEventsConsumer.name);
  private readonly sqsClient = new SQSClient({});
  private readonly queueUrl = process.env.QUEUE_URL?.trim();
  private isRunning = false;
  private poller?: Promise<void>;

  constructor(private readonly notificacionRepository: NotificacionRepository) {}

  onModuleInit(): void {
    if (!this.queueUrl) {
      this.logger.warn('QUEUE_URL no esta configurado; no se consumiran eventos de notificacion.');
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
      const idPedido = this.extractIdPedido(payload);
      await this.notificacionRepository.createFromEvent(payload.evento, idPedido);
      this.logger.log(`Notificacion registrada para evento ${payload.evento}.`);
    }

    await this.sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: this.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  private parseMessageBody(body: string | undefined): NotificacionEventPayload | null {
    if (!body) {
      return null;
    }

    try {
      const parsed = JSON.parse(body) as unknown;

      if (this.isNotificacionEventPayload(parsed)) {
        return parsed;
      }

      if (this.isSnsEnvelope(parsed)) {
        const snsMessage = JSON.parse(parsed.Message) as unknown;
        return this.isNotificacionEventPayload(snsMessage) ? snsMessage : null;
      }
    } catch (error) {
      this.logger.warn(`Mensaje SQS ignorado por JSON invalido: ${(error as Error).message}`);
    }

    return null;
  }

  private isNotificacionEventPayload(value: unknown): value is NotificacionEventPayload {
    if (typeof value !== 'object' || value === null || !('evento' in value)) {
      return false;
    }

    const evento = (value as { evento?: unknown }).evento;
    return typeof evento === 'string' && NOTIFICACION_CONSUMED_EVENTOS.has(evento);
  }

  private extractIdPedido(payload: NotificacionEventPayload): string | null {
    const idPedido = payload.pedido?.id_pedido ?? payload.id_pedido;
    return typeof idPedido === 'string' && /^[0-9a-f-]{36}$/i.test(idPedido.trim()) ? idPedido.trim() : null;
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
