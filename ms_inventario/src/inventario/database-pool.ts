import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';

type PgSslConfig = false | { rejectUnauthorized: false };

export interface DatabaseClient {
  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

@Injectable()
export class DatabasePool implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    this.pool = new Pool(this.getPoolConfiguration());
  }

  query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params);
  }

  async transaction<T>(handler: (client: DatabaseClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');
      const result = await handler(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }

  private getPoolConfiguration(): PoolConfig {
    if (process.env.DATABASE_URL) {
      return {
        connectionString: process.env.DATABASE_URL,
        ssl: this.shouldUseSsl(),
      };
    }

    return {
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT || 5432),
      database: process.env.DATABASE_NAME,
      user: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      ssl: this.shouldUseSsl(),
    };
  }

  private shouldUseSsl(): PgSslConfig {
    if (process.env.DATABASE_SSL === 'false') {
      return false;
    }

    if (process.env.DATABASE_SSL === 'true') {
      return { rejectUnauthorized: false };
    }

    const databaseEndpoint = process.env.DATABASE_URL || process.env.DATABASE_HOST || '';
    return databaseEndpoint.includes('.rds.amazonaws.com') ? { rejectUnauthorized: false } : false;
  }

  private async rollback(client: PoolClient): Promise<void> {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original transaction error.
    }
  }
}
