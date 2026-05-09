import { DatabasePool } from './inventario/database-pool';
import { getDatabaseSchema } from './inventario/database-schema';
import { MongoClient } from 'mongodb';

async function dropPreviewSchema(): Promise<void> {
  const schema = getDatabaseSchema();
  if (!schema.startsWith('pr_')) {
    throw new Error(`No se puede eliminar el schema no efimero '${schema}'.`);
  }

  const databasePool = new DatabasePool();
  await databasePool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await databasePool.onModuleDestroy();
  console.log(`Dropped preview schema ${schema}`);

  const mongodbDatabase = process.env.MONGODB_DATABASE;
  const mongodbUri = process.env.MONGODB_URI?.trim();
  if (mongodbUri && mongodbDatabase?.startsWith('smartlogix_inventario_pr_')) {
    const mongoClient = new MongoClient(mongodbUri);
    await mongoClient.db(mongodbDatabase).dropDatabase();
    await mongoClient.close();
    console.log(`Dropped preview MongoDB database ${mongodbDatabase}`);
  }
}

dropPreviewSchema().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
