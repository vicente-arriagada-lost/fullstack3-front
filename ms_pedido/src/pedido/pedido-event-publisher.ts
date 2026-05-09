import { Injectable, Logger } from '@nestjs/common';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { Pedido } from './pedido.types';

export const PEDIDO_EVENTOS = {
  CREADO: 'pedido_creado',
  ACTUALIZADO: 'pedido_actualizado',
  CANCELADO: 'pedido_cancelado',
  APROBADO: 'pedido_aprobado',
  FINALIZADO: 'pedido_finalizado',
} as const;

export type PedidoEvento = (typeof PEDIDO_EVENTOS)[keyof typeof PEDIDO_EVENTOS];

@Injectable()
export class PedidoEventPublisher {
  private readonly logger = new Logger(PedidoEventPublisher.name);
  private readonly snsClient = new SNSClient({});
  private readonly topicArn = process.env.EVENTS_TOPIC_ARN?.trim();

  async publishPedidoCreado(pedido: Pedido): Promise<void> {
    await this.publishPedidoEvent(PEDIDO_EVENTOS.CREADO, pedido);
  }

  async publishPedidoActualizado(pedido: Pedido): Promise<void> {
    await this.publishPedidoEvent(PEDIDO_EVENTOS.ACTUALIZADO, pedido);
  }

  async publishPedidoCancelado(pedido: Pedido): Promise<void> {
    await this.publishPedidoEvent(PEDIDO_EVENTOS.CANCELADO, pedido);
  }

  async publishPedidoAprobado(pedido: Pedido): Promise<void> {
    await this.publishPedidoEvent(PEDIDO_EVENTOS.APROBADO, pedido);
  }

  async publishPedidoFinalizado(pedido: Pedido): Promise<void> {
    await this.publishPedidoEvent(PEDIDO_EVENTOS.FINALIZADO, pedido);
  }

  private async publishPedidoEvent(evento: PedidoEvento, pedido: Pedido): Promise<void> {
    if (!this.topicArn) {
      if (process.env.NODE_ENV !== 'test') {
        this.logger.warn(`EVENTS_TOPIC_ARN no esta configurado; se omite publicacion de ${evento}.`);
      }
      return;
    }

    await this.snsClient.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify({
          evento,
          ocurrido_en: new Date().toISOString(),
          pedido,
        }),
        MessageAttributes: {
          evento: {
            DataType: 'String',
            StringValue: evento,
          },
        },
      }),
    );
  }
}
