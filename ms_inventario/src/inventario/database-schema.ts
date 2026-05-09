const DEFAULT_SCHEMA = 'public';
const VALID_SCHEMA_PATTERN = /^[a-z][a-z0-9_]*$/;

export function getDatabaseSchema(): string {
  const schema = process.env.DATABASE_SCHEMA || DEFAULT_SCHEMA;

  if (!VALID_SCHEMA_PATTERN.test(schema)) {
    throw new Error('DATABASE_SCHEMA debe comenzar con una letra y usar solo minusculas, numeros o guion bajo.');
  }

  return schema;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function getInventarioTrazabilidadTableName(): string {
  return `${quoteIdentifier(getDatabaseSchema())}.inventario_trazabilidad`;
}
