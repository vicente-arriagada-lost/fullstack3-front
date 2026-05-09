import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MensajeriaRequestValidator } from './mensajeria-request-validator';
import { MensajeriaRepository } from './mensajeria.repository';
import { MensajeriaService } from './mensajeria.service';

type MensajeriaRepositoryMock = jest.Mocked<Pick<MensajeriaRepository, 'create' | 'findById' | 'update' | 'delete'>>;

describe('MensajeriaService', () => {
  const repository: MensajeriaRepositoryMock = {
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  const validator = new MensajeriaRequestValidator();
  const service = new MensajeriaService(repository as unknown as MensajeriaRepository, validator);
  const idMensaje = 'c09d1c90-6294-4a8b-b4d7-3e98e2dc89df';
  const mensaje = {
    id_mensaje: idMensaje,
    asunto: 'Despacho',
    cuerpo: 'Pedido listo',
    responsable: 'Operaciones',
    fecha_envio: new Date('2026-05-02T12:00:00.000Z'),
    destinatarios: ['cliente@example.com'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('obtiene un mensaje por id', async () => {
    repository.findById.mockResolvedValue(mensaje);

    await expect(service.getById(idMensaje)).resolves.toEqual(mensaje);
    expect(repository.findById).toHaveBeenCalledWith(idMensaje);
  });

  test('retorna NotFound si no existe el mensaje', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.getById(idMensaje)).rejects.toThrow(NotFoundException);
  });

  test('actualiza un mensaje existente', async () => {
    repository.update.mockResolvedValue({ ...mensaje, asunto: 'Nuevo asunto' });

    await expect(service.update(idMensaje, { asunto: 'Nuevo asunto' })).resolves.toEqual({
      ...mensaje,
      asunto: 'Nuevo asunto',
    });
    expect(repository.update).toHaveBeenCalledWith(idMensaje, { asunto: 'Nuevo asunto' });
  });

  test('rechaza id invalido antes de consultar repositorio', async () => {
    await expect(service.delete('id-invalido')).rejects.toThrow(BadRequestException);
    expect(repository.delete).not.toHaveBeenCalled();
  });
});
