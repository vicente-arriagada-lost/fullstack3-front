import { Injectable, Logger } from '@nestjs/common';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { Pedido, StockEvaluadoEvent } from './inventario.types';

export const INVENTARIO_EVENTOS = {
  STOCK_APROBADO: 'stock_aprobado',
  STOCK_RECHAZADO: 'stock_rechazado',
} as const;

@Injectable()
export class InventarioEventPublisher {
  private readonly logger = new Logger(InventarioEventPublisher.name);
  private readonly snsClient = new SNSClient({});
  private readonly topicArn = process.env.EVENTS_TOPIC_ARN?.trim();

  async publishStockAprobado(pedido: Pedido, productos: StockEvaluadoEvent['productos']): Promise<void> {
    await this.publishStockEvent(INVENTARIO_EVENTOS.STOCK_APROBADO, pedido, productos);
  }

  async publishStockRechazado(pedido: Pedido, productos: StockEvaluadoEvent['productos']): Promise<void> {
    await this.publishStockEvent(INVENTARIO_EVENTOS.STOCK_RECHAZADO, pedido, productos);
  }

  private async publishStockEvent(
    evento: StockEvaluadoEvent['evento'],
    pedido: Pedido,
    productos: StockEvaluadoEvent['productos'],
  ): Promise<void> {
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
          productos,
        } satisfies StockEvaluadoEvent),
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
