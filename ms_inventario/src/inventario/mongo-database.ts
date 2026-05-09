import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Collection, Db, MongoClient } from 'mongodb';
import { Producto, ReservaInventario } from './inventario.types';

const DEFAULT_MONGODB_DATABASE = 'smartlogix_inventario';
const INVENTARIO_COLLECTION = 'inventario';
const RESERVAS_COLLECTION = 'inventario_reservas';

@Injectable()
export class MongoDatabase implements OnModuleDestroy {
  private readonly client: MongoClient;
  private database?: Db;

  constructor() {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) {
      throw new Error('MONGODB_URI es requerido para ms_inventario.');
    }

    this.client = new MongoClient(uri, {
      ignoreUndefined: true,
    });
  }

  async getInventarioCollection(): Promise<Collection<Producto>> {
    return this.getDatabase().collection<Producto>(INVENTARIO_COLLECTION);
  }

  async getReservasCollection(): Promise<Collection<ReservaInventario>> {
    return this.getDatabase().collection<ReservaInventario>(RESERVAS_COLLECTION);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.close();
  }

  private getDatabase(): Db {
    if (!this.database) {
      this.database = this.client.db(process.env.MONGODB_DATABASE || DEFAULT_MONGODB_DATABASE);
    }

    return this.database;
  }
}
