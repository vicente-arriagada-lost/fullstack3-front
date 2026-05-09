import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventarioEventPublisher } from './inventario-event-publisher';
import { InventarioRequestValidator } from './inventario-request-validator';
import { InventarioRepository } from './inventario.repository';
import { InventarioService } from './inventario.service';
import { Producto } from './inventario.types';
import { TrazabilidadRepository } from './trazabilidad.repository';

type InventarioRepositoryMock = jest.Mocked<
  Pick<
    InventarioRepository,
    | 'create'
    | 'update'
    | 'delete'
    | 'findAll'
    | 'findByIds'
    | 'findReservaByPedido'
    | 'createReserva'
    | 'createRejectedReserva'
    | 'reserveProducts'
    | 'consumeReserva'
    | 'releaseReserva'
  >
>;
type TrazabilidadRepositoryMock = jest.Mocked<Pick<TrazabilidadRepository, 'create'>>;
type InventarioEventPublisherMock = jest.Mocked<Pick<InventarioEventPublisher, 'publishStockAprobado' | 'publishStockRechazado'>>;

describe('InventarioService', () => {
  const repository: InventarioRepositoryMock = {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findAll: jest.fn(),
    findByIds: jest.fn(),
    findReservaByPedido: jest.fn(),
    createReserva: jest.fn(),
    createRejectedReserva: jest.fn(),
    reserveProducts: jest.fn(),
    consumeReserva: jest.fn(),
    releaseReserva: jest.fn(),
  };
  const trazabilidadRepository: TrazabilidadRepositoryMock = {
    create: jest.fn(),
  };
  const eventPublisher: InventarioEventPublisherMock = {
    publishStockAprobado: jest.fn(),
    publishStockRechazado: jest.fn(),
  };
  const validator = new InventarioRequestValidator();

  beforeEach(() => {
    jest.clearAllMocks();
    trazabilidadRepository.create.mockResolvedValue({
      id_trazabilidad: '9f1bf274-9f41-4ee4-80c9-26a0dbe00d8e',
      fecha_hora: new Date(),
      id_producto: 'sku-1',
      nombre_responsable: 'Ana Perez',
    });
    eventPublisher.publishStockAprobado.mockResolvedValue(undefined);
    eventPublisher.publishStockRechazado.mockResolvedValue(undefined);
    repository.findReservaByPedido.mockResolvedValue(null);
    repository.createReserva.mockResolvedValue({
      id_pedido: 'pedido-1',
      productos: [{ id_producto: 'sku-1', cantidad: 3 }],
      estado: 'reservado',
      fecha_creacion: new Date(),
      fecha_actualizacion: new Date(),
    });
    repository.createRejectedReserva.mockResolvedValue({
      id_pedido: 'pedido-1',
      productos: [{ id_producto: 'sku-1', cantidad: 3 }],
      estado: 'rechazado',
      fecha_creacion: new Date(),
      fecha_actualizacion: new Date(),
    });
    repository.reserveProducts.mockResolvedValue(undefined);
    repository.consumeReserva.mockResolvedValue(null);
    repository.releaseReserva.mockResolvedValue(null);
  });

  test('crea productos y registra trazabilidad', async () => {
    repository.create.mockImplementation((producto: Producto) => Promise.resolve(producto));
    const service = new InventarioService(repository, trazabilidadRepository, eventPublisher, validator);

    const producto = await service.create({
      id_producto: 'sku-1',
      nombre: 'Caja grande',
      tipo: 'embalaje',
      stock: { cantidad_disponible: 10 },
      atributos: { color: 'azul' },
      nombre_responsable: 'Ana Perez',
    });

    expect(producto).toMatchObject({
      id_producto: 'sku-1',
      nombre: 'Caja grande',
      tipo: 'embalaje',
      stock: { cantidad_disponible: 10, cantidad_reservada: 0 },
      atributos: { color: 'azul' },
      activo: true,
    });
    expect(repository.create).toHaveBeenCalledTimes(1);
    expect(trazabilidadRepository.create).toHaveBeenCalledWith('sku-1', 'Ana Perez');
  });

  test('rechaza crear productos sin stock valido', async () => {
    const service = new InventarioService(repository, trazabilidadRepository, eventPublisher, validator);

    await expect(
      service.create({
        id_producto: 'sku-1',
        nombre: 'Caja grande',
        tipo: 'embalaje',
        stock: { cantidad_disponible: -1 },
        nombre_responsable: 'Ana Perez',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  test('retorna not found al actualizar producto inexistente', async () => {
    repository.update.mockResolvedValue(null);
    const service = new InventarioService(repository, trazabilidadRepository, eventPublisher, validator);

    await expect(
      service.update('sku-1', {
        nombre: 'Caja mediana',
        nombre_responsable: 'Ana Perez',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(trazabilidadRepository.create).not.toHaveBeenCalled();
  });

  test('publica stock_aprobado cuando todos los productos tienen stock', async () => {
    repository.findByIds.mockResolvedValue([
      {
        id_producto: 'sku-1',
        nombre: 'Caja grande',
        tipo: 'embalaje',
        stock: { cantidad_disponible: 10, cantidad_reservada: 0 },
        atributos: {},
        activo: true,
        fecha_creacion: new Date(),
        fecha_actualizacion: new Date(),
      },
    ]);
    const service = new InventarioService(repository, trazabilidadRepository, eventPublisher, validator);

    await service.evaluatePedidoStock({
      id_pedido: 'pedido-1',
      productos: [{ id_producto: 'sku-1', cantidad: 3 }],
    });

    expect(repository.createReserva).toHaveBeenCalledWith('pedido-1', [{ id_producto: 'sku-1', cantidad: 3 }], expect.any(Date));
    expect(repository.reserveProducts).toHaveBeenCalledWith([{ id_producto: 'sku-1', cantidad: 3 }], expect.any(Date));
    expect(eventPublisher.publishStockAprobado).toHaveBeenCalledTimes(1);
    expect(eventPublisher.publishStockRechazado).not.toHaveBeenCalled();
  });

  test('publica stock_rechazado cuando falta un producto', async () => {
    repository.findByIds.mockResolvedValue([]);
    const service = new InventarioService(repository, trazabilidadRepository, eventPublisher, validator);

    await service.evaluatePedidoStock({
      id_pedido: 'pedido-1',
      productos: [{ id_producto: 'sku-404', cantidad: 1 }],
    });

    expect(eventPublisher.publishStockRechazado).toHaveBeenCalledWith(
      { id_pedido: 'pedido-1', productos: [{ id_producto: 'sku-404', cantidad: 1 }] },
      [
        {
          id_producto: 'sku-404',
          cantidad: 1,
          cantidad_disponible: 0,
          aprobado: false,
          motivo: 'producto_no_existe',
        },
      ],
    );
    expect(repository.createRejectedReserva).toHaveBeenCalledWith(
      'pedido-1',
      [{ id_producto: 'sku-404', cantidad: 1 }],
      expect.any(Date),
    );
    expect(eventPublisher.publishStockAprobado).not.toHaveBeenCalled();
  });

  test('consume reserva cuando llega pedido_aprobado', async () => {
    const service = new InventarioService(repository, trazabilidadRepository, eventPublisher, validator);

    await service.consumePedidoAprobado('pedido-1');

    expect(repository.consumeReserva).toHaveBeenCalledWith('pedido-1', expect.any(Date));
  });

  test('libera stock reservado o consumido cuando llega cancelacion o envio_rechazado', async () => {
    const service = new InventarioService(repository, trazabilidadRepository, eventPublisher, validator);

    await service.releasePedidoStock('pedido-1');

    expect(repository.releaseReserva).toHaveBeenCalledWith('pedido-1', expect.any(Date));
  });
});
