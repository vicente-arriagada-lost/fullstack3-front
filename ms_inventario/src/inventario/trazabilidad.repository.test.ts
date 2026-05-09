import { DatabasePool } from './database-pool';
import { TrazabilidadRepository } from './trazabilidad.repository';

type DatabasePoolMock = jest.Mocked<Pick<DatabasePool, 'query'>>;

describe('TrazabilidadRepository', () => {
  const databasePool: DatabasePoolMock = {
    query: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('registra trazabilidad con id autogenerado', async () => {
    const fecha = new Date();
    databasePool.query.mockResolvedValue({
      rows: [
        {
          id_trazabilidad: '1b0cb4ad-2d7c-47a3-8f24-158a02f466f4',
          fecha_hora: fecha,
          id_producto: 'sku-1',
          nombre_responsable: 'Ana Perez',
        },
      ],
      command: 'INSERT',
      rowCount: 1,
      oid: 0,
      fields: [],
    });

    const repository = new TrazabilidadRepository(databasePool as unknown as DatabasePool);
    const trazabilidad = await repository.create('sku-1', 'Ana Perez');

    expect(trazabilidad).toEqual({
      id_trazabilidad: '1b0cb4ad-2d7c-47a3-8f24-158a02f466f4',
      fecha_hora: fecha,
      id_producto: 'sku-1',
      nombre_responsable: 'Ana Perez',
    });
    expect(databasePool.query).toHaveBeenCalledTimes(1);
    expect(databasePool.query.mock.calls[0]?.[1]?.[0]).toEqual(expect.any(String));
    expect(databasePool.query.mock.calls[0]?.[1]?.[1]).toBe('sku-1');
  });
});
