import { DatabasePool } from './database-pool';
import { MensajeriaRepository } from './mensajeria.repository';

type DatabasePoolMock = jest.Mocked<Pick<DatabasePool, 'query'>>;

describe('MensajeriaRepository', () => {
  const databasePool: DatabasePoolMock = {
    query: jest.fn(),
  };
  const fechaEnvio = new Date('2026-05-02T12:00:00.000Z');
  const mensaje = {
    id_mensaje: 'c09d1c90-6294-4a8b-b4d7-3e98e2dc89df',
    asunto: 'Despacho',
    cuerpo: 'Pedido listo',
    responsable: 'Operaciones',
    fecha_envio: fechaEnvio,
    destinatarios: ['cliente@example.com'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('crea registro de mensajeria', async () => {
    databasePool.query.mockResolvedValue({
      rows: [mensaje],
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const repository = new MensajeriaRepository(databasePool as unknown as DatabasePool);

    await expect(repository.create(mensaje)).resolves.toEqual(mensaje);
    expect(databasePool.query).toHaveBeenCalledTimes(1);
    expect(databasePool.query.mock.calls[0]?.[1]).toEqual([
      mensaje.id_mensaje,
      mensaje.asunto,
      mensaje.cuerpo,
      mensaje.responsable,
      mensaje.fecha_envio,
      mensaje.destinatarios,
    ]);
  });

  test('actualiza solo los campos enviados', async () => {
    databasePool.query.mockResolvedValue({
      rows: [{ ...mensaje, asunto: 'Nuevo asunto', destinatarios: ['nuevo@example.com'] }],
      command: 'UPDATE',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const repository = new MensajeriaRepository(databasePool as unknown as DatabasePool);
    const updated = await repository.update(mensaje.id_mensaje, {
      asunto: 'Nuevo asunto',
      destinatarios: ['nuevo@example.com'],
    });

    expect(updated?.asunto).toBe('Nuevo asunto');
    expect(databasePool.query.mock.calls[0]?.[0]).toContain('SET asunto = $1, destinatarios = $2');
    expect(databasePool.query.mock.calls[0]?.[1]).toEqual([
      'Nuevo asunto',
      ['nuevo@example.com'],
      mensaje.id_mensaje,
    ]);
  });

  test('elimina por id y retorna el registro eliminado', async () => {
    databasePool.query.mockResolvedValue({
      rows: [mensaje],
      command: 'DELETE',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const repository = new MensajeriaRepository(databasePool as unknown as DatabasePool);

    await expect(repository.delete(mensaje.id_mensaje)).resolves.toEqual(mensaje);
    expect(databasePool.query.mock.calls[0]?.[1]).toEqual([mensaje.id_mensaje]);
  });
});
