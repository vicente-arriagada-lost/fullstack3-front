import { DatabasePool } from './pedido/database-pool';
import { getDatabaseSchema } from './pedido/database-schema';

async function dropPreviewSchema(): Promise<void> {
  const schema = getDatabaseSchema();
  if (!schema.startsWith('pr_')) {
    throw new Error(`No se puede eliminar el schema no efimero '${schema}'.`);
  }

  const databasePool = new DatabasePool();
  await databasePool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await databasePool.onModuleDestroy();
  console.log(`Dropped preview schema ${schema}`);
}

dropPreviewSchema().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
