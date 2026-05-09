import { NotificacionController } from './notificacion.controller';
import { MensajeriaService } from './mensajeria.service';

type MensajeriaServiceMock = jest.Mocked<Pick<MensajeriaService, 'create' | 'getById' | 'update' | 'delete'>>;

describe('NotificacionController', () => {
  const mensajeriaService: MensajeriaServiceMock = {
    create: jest.fn(),
    getById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('expone health operacional bajo api/notificaciones', () => {
    const controller = new NotificacionController(mensajeriaService as unknown as MensajeriaService);

    expect(controller.getHealth()).toEqual({
      status: 'ok',
      service: 'notificaciones',
    });
  });

  test('delega creacion de mensajeria al servicio', async () => {
    const fechaEnvio = new Date('2026-05-02T12:00:00.000Z');
    mensajeriaService.create.mockResolvedValue({
      id_mensaje: 'c09d1c90-6294-4a8b-b4d7-3e98e2dc89df',
      asunto: 'Despacho',
      cuerpo: 'Pedido en preparacion',
      responsable: 'Operaciones',
      fecha_envio: fechaEnvio,
      destinatarios: ['cliente@example.com'],
    });

    const controller = new NotificacionController(mensajeriaService as unknown as MensajeriaService);
    const body = {
      asunto: 'Despacho',
      cuerpo: 'Pedido en preparacion',
      responsable: 'Operaciones',
      fecha_envio: '2026-05-02T12:00:00.000Z',
      destinatarios: ['cliente@example.com'],
    };

    await expect(controller.createMensaje(body)).resolves.toEqual({
      id_mensaje: 'c09d1c90-6294-4a8b-b4d7-3e98e2dc89df',
      asunto: 'Despacho',
      cuerpo: 'Pedido en preparacion',
      responsable: 'Operaciones',
      fecha_envio: fechaEnvio,
      destinatarios: ['cliente@example.com'],
    });
    expect(mensajeriaService.create).toHaveBeenCalledWith(body);
  });
});
