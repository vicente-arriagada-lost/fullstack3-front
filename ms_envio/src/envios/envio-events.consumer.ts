import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { EnviosService } from './envios.service';
import { EstadoEnvio } from './envio.entity';

@Injectable()
export class EnvioEventsConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EnvioEventsConsumer.name);
  private readonly sqsClient = new SQSClient({});
  private readonly queueUrl = process.env.QUEUE_URL ?? '';
  private isRunning = false;

  constructor(private readonly enviosService: EnviosService) {}

  onModuleInit(): void {
    if (!this.queueUrl) {
      this.logger.warn('QUEUE_URL no configurado, consumidor SQS no iniciado');
      return;
    }
    this.isRunning = true;
    void this.pollQueue();
  }

  onModuleDestroy(): void {
    this.isRunning = false;
  }

  private async pollQueue(): Promise<void> {
    while (this.isRunning) {
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
        this.logger.error('Error al leer de SQS', error);
        await new Promise<void>((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async processMessage(message: Message): Promise<void> {
    try {
      const body = this.parseBody(message.Body ?? '');
      const evento = body.evento as string | undefined;

      if (evento === 'pedido_aprobado') {
        await this.handlePedidoAprobado(body);
      } else if (evento === 'pedido_cancelado') {
        await this.handlePedidoCancelado(body);
      } else if (evento === 'pedido_actualizado') {
        await this.handlePedidoActualizado(body);
      }

      await this.sqsClient.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle!,
        }),
      );
    } catch (error) {
      this.logger.error(`Error procesando mensaje ${message.MessageId}`, error);
    }
  }

  private parseBody(raw: string): Record<string, unknown> {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.Message === 'string') {
      return JSON.parse(parsed.Message) as Record<string, unknown>;
    }
    return parsed;
  }

  private async handlePedidoAprobado(body: Record<string, unknown>): Promise<void> {
    const pedido = body.pedido as { id?: string; direccionDestino?: string; ciudadDestino?: string } | undefined;
    if (!pedido?.id || !pedido.direccionDestino || !pedido.ciudadDestino) return;
    await this.enviosService.createDesdePedidoAprobado(pedido.id, pedido.direccionDestino, pedido.ciudadDestino);
  }

  private async handlePedidoCancelado(body: Record<string, unknown>): Promise<void> {
    const pedido = body.pedido as { id?: string } | undefined;
    const pedidoId = pedido?.id;
    if (!pedidoId) return;

    const envios = await this.enviosService.findByPedidoId(pedidoId);
    for (const envio of envios) {
      if (envio.estado !== EstadoEnvio.CANCELADO && envio.estado !== EstadoEnvio.ENTREGADO) {
        await this.enviosService.update(envio.id, { estado: EstadoEnvio.CANCELADO });
      }
    }
  }

  private async handlePedidoActualizado(body: Record<string, unknown>): Promise<void> {
    const pedido = body.pedido as Record<string, unknown> | undefined;
    if (!pedido?.id) return;

    const envios = await this.enviosService.findByPedidoId(pedido.id as string);
    for (const envio of envios) {
      const updates: { direccionDestino?: string; ciudadDestino?: string } = {};
      if (typeof pedido.direccionDestino === 'string') updates.direccionDestino = pedido.direccionDestino;
      if (typeof pedido.ciudadDestino === 'string') updates.ciudadDestino = pedido.ciudadDestino;
      if (Object.keys(updates).length > 0) {
        await this.enviosService.update(envio.id, updates);
      }
    }
  }
}
