import { ConflictException, Injectable } from '@nestjs/common';
import { Collection, MongoServerError } from 'mongodb';
import { PedidoProducto, Producto, ProductoUpdateFields, ReservaInventario } from './inventario.types';
import { MongoDatabase } from './mongo-database';

@Injectable()
export class InventarioRepository {
  constructor(private readonly mongoDatabase: MongoDatabase) {}

  async create(producto: Producto): Promise<Producto> {
    try {
      const collection = await this.getCollection();
      await collection.insertOne(producto);
      return producto;
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('Ya existe un producto con ese id_producto.');
      }
      throw error;
    }
  }

  async update(idProducto: string, fields: ProductoUpdateFields, now: Date): Promise<Producto | null> {
    const collection = await this.getCollection();
    const result = await collection.findOneAndUpdate(
      { id_producto: idProducto },
      {
        $set: {
          ...fields,
          fecha_actualizacion: now,
        },
      },
      { returnDocument: 'after', projection: { _id: 0 } },
    );

    return result;
  }

  async delete(idProducto: string): Promise<Producto | null> {
    const collection = await this.getCollection();
    const result = await collection.findOneAndDelete({ id_producto: idProducto }, { projection: { _id: 0 } });
    return result;
  }

  async findAll(): Promise<Producto[]> {
    const collection = await this.getCollection();
    return collection.find({}, { projection: { _id: 0 } }).sort({ nombre: 1, id_producto: 1 }).toArray();
  }

  async findByIds(idProductos: string[]): Promise<Producto[]> {
    const collection = await this.getCollection();
    return collection.find({ id_producto: { $in: idProductos } }, { projection: { _id: 0 } }).toArray();
  }

  async findReservaByPedido(idPedido: string): Promise<ReservaInventario | null> {
    const collection = await this.getReservasCollection();
    return collection.findOne({ id_pedido: idPedido }, { projection: { _id: 0 } });
  }

  async createReserva(idPedido: string, productos: PedidoProducto[], now: Date): Promise<ReservaInventario> {
    const reserva: ReservaInventario = {
      id_pedido: idPedido,
      productos,
      estado: 'reservado',
      fecha_creacion: now,
      fecha_actualizacion: now,
    };

    const collection = await this.getReservasCollection();
    try {
      await collection.insertOne(reserva);
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('Ya existe una reserva de inventario para ese pedido.');
      }
      throw error;
    }

    return reserva;
  }

  async reserveProducts(productos: PedidoProducto[], now: Date): Promise<void> {
    await this.adjustProductsStock(productos, {
      availableDeltaSign: -1,
      reservedDeltaSign: 1,
      now,
    });
  }

  async consumeReserva(idPedido: string, now: Date): Promise<ReservaInventario | null> {
    const reserva = await this.findReservaByPedido(idPedido);
    if (!reserva || reserva.estado !== 'reservado') {
      return reserva;
    }

    await this.adjustProductsStock(reserva.productos, {
      availableDeltaSign: 0,
      reservedDeltaSign: -1,
      now,
    });

    return this.updateReservaEstado(idPedido, 'consumido', now);
  }

  async releaseReserva(idPedido: string, now: Date): Promise<ReservaInventario | null> {
    const reserva = await this.findReservaByPedido(idPedido);
    if (!reserva || reserva.estado === 'liberado' || reserva.estado === 'rechazado') {
      return reserva;
    }

    await this.adjustProductsStock(reserva.productos, {
      availableDeltaSign: 1,
      reservedDeltaSign: reserva.estado === 'reservado' ? -1 : 0,
      now,
    });

    return this.updateReservaEstado(idPedido, 'liberado', now);
  }

  async createRejectedReserva(idPedido: string, productos: PedidoProducto[], now: Date): Promise<ReservaInventario> {
    const reserva: ReservaInventario = {
      id_pedido: idPedido,
      productos,
      estado: 'rechazado',
      fecha_creacion: now,
      fecha_actualizacion: now,
    };

    const collection = await this.getReservasCollection();
    await collection.updateOne(
      { id_pedido: idPedido },
      { $setOnInsert: reserva },
      { upsert: true },
    );

    const stored = await this.findReservaByPedido(idPedido);
    return stored as ReservaInventario;
  }

  private async getCollection(): Promise<Collection<Producto>> {
    return this.mongoDatabase.getInventarioCollection();
  }

  private async getReservasCollection(): Promise<Collection<ReservaInventario>> {
    return this.mongoDatabase.getReservasCollection();
  }

  private async updateReservaEstado(
    idPedido: string,
    estado: ReservaInventario['estado'],
    now: Date,
  ): Promise<ReservaInventario | null> {
    const collection = await this.getReservasCollection();
    return collection.findOneAndUpdate(
      { id_pedido: idPedido },
      {
        $set: {
          estado,
          fecha_actualizacion: now,
        },
      },
      { returnDocument: 'after', projection: { _id: 0 } },
    );
  }

  private async adjustProductsStock(
    productos: PedidoProducto[],
    options: {
      availableDeltaSign: -1 | 0 | 1;
      reservedDeltaSign: -1 | 0 | 1;
      now: Date;
    },
  ): Promise<void> {
    if (productos.length === 0) {
      return;
    }

    const collection = await this.getCollection();
    await collection.bulkWrite(
      productos.map((producto) => ({
        updateOne: {
          filter: { id_producto: producto.id_producto },
          update: {
            $inc: {
              'stock.cantidad_disponible': producto.cantidad * options.availableDeltaSign,
              'stock.cantidad_reservada': producto.cantidad * options.reservedDeltaSign,
            },
            $set: {
              fecha_actualizacion: options.now,
            },
          },
        },
      })),
    );
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return error instanceof MongoServerError && error.code === 11000;
  }
}
