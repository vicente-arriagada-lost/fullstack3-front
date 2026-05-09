import { NotificacionEventsConsumer } from './notificacion-events.consumer';
import { NotificacionRepository } from './notificacion.repository';

type NotificacionRepositoryMock = jest.Mocked<Pick<NotificacionRepository, 'createFromEvent'>>;

describe('NotificacionEventsConsumer', () => {
  const repository: NotificacionRepositoryMock = {
    createFromEvent: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    repository.createFromEvent.mockResolvedValue({
      id_notificacion: 'c09d1c90-6294-4a8b-b4d7-3e98e2dc89df',
      id_pedido: '7d25ed8e-471e-4d1a-a432-bfccca5cfe4f',
      tipo_notificacion: 'envio_rechazado',
      fecha: new Date(),
      mensaje: 'Envio rechazado, solicite de nuevo.',
      status: 'sin entregar',
    });
  });

  test('registra eventos de notificacion con id_pedido valido', async () => {
    const idPedido = '7d25ed8e-471e-4d1a-a432-bfccca5cfe4f';
    const consumer = new NotificacionEventsConsumer(repository as unknown as NotificacionRepository) as unknown as {
      processMessage(message: { Body?: string; ReceiptHandle?: string }): Promise<void>;
      queueUrl: string;
      sqsClient: { send: jest.Mock };
    };
    consumer.queueUrl = 'https://sqs.test/queue';
    consumer.sqsClient = { send: jest.fn().mockResolvedValue({}) };

    await consumer.processMessage({
      Body: JSON.stringify({
        evento: 'envio_rechazado',
        pedido: { id_pedido: idPedido },
      }),
      ReceiptHandle: 'receipt',
    });

    expect(repository.createFromEvent).toHaveBeenCalledWith('envio_rechazado', idPedido);
  });

  test('ignora eventos que no pertenecen a notificaciones', async () => {
    const consumer = new NotificacionEventsConsumer(repository as unknown as NotificacionRepository) as unknown as {
      processMessage(message: { Body?: string; ReceiptHandle?: string }): Promise<void>;
      queueUrl: string;
      sqsClient: { send: jest.Mock };
    };
    consumer.queueUrl = 'https://sqs.test/queue';
    consumer.sqsClient = { send: jest.fn().mockResolvedValue({}) };

    await consumer.processMessage({
      Body: JSON.stringify({
        evento: 'pedido_cancelado',
        pedido: { id_pedido: '7d25ed8e-471e-4d1a-a432-bfccca5cfe4f' },
      }),
      ReceiptHandle: 'receipt',
    });

    expect(repository.createFromEvent).not.toHaveBeenCalled();
  });
});
