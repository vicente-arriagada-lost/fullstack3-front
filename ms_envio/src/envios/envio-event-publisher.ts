import { Injectable, Logger } from '@nestjs/common';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { Envio } from './envio.entity';

type EnvioEvento = 'envio_pendiente' | 'envio_aprobado' | 'envio_rechazado' | 'envio_finalizado';

@Injectable()
export class EnvioEventPublisher {
  private readonly logger = new Logger(EnvioEventPublisher.name);
  private readonly snsClient = new SNSClient({});
  private readonly topicArn = process.env.EVENTS_TOPIC_ARN ?? '';

  async publishEnvioAprobado(envio: Envio): Promise<void> {
    await this.publish('envio_aprobado', envio);
  }

  async publishEnvioRechazado(envio: Envio): Promise<void> {
    await this.publish('envio_rechazado', envio);
  }

  async publishEnvioFinalizado(envio: Envio): Promise<void> {
    await this.publish('envio_finalizado', envio);
  }

  async publishEnvioPendiente(envio: Envio): Promise<void> {
    await this.publish('envio_pendiente', envio);
  }

  private async publish(evento: EnvioEvento, envio: Envio): Promise<void> {
    if (!this.topicArn) {
      this.logger.warn(`EVENTS_TOPIC_ARN no configurado, omitiendo evento ${evento}`);
      return;
    }
    await this.snsClient.send(
      new PublishCommand({
        TopicArn: this.topicArn,
        Message: JSON.stringify({ evento, ocurrido_en: new Date().toISOString(), envio }),
        MessageAttributes: {
          evento: { DataType: 'String', StringValue: evento },
        },
      }),
    );
    this.logger.log(`Evento ${evento} publicado para envio ${envio.id}`);
  }
}
