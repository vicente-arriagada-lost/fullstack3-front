# ms_inventario

Microservicio de inventario Smartlogix.

## HTTP

- `POST /api/inventario`: crea un producto.
- `PATCH /api/inventario/:id_producto`: actualiza un producto.
- `DELETE /api/inventario/:id_producto`: elimina un producto. Recibe `nombre_responsable` por body o query string.
- `GET /api/inventario`: lista productos.
- `GET /`: health check.

## Persistencia

- MongoDB: coleccion `inventario`, con documentos flexibles para productos de cualquier tipo, y `inventario_reservas` para reservas por pedido.
- PostgreSQL: tabla `inventario_trazabilidad` con `id_trazabilidad`, `fecha_hora`, `id_producto` y `nombre_responsable`.

## Eventos

Consume `pedido_creado`, `pedido_aprobado`, `pedido_cancelado` y `envio_rechazado` desde SQS. Para cada pedido creado valida existencia, estado activo y stock disponible de los productos:

- Reserva stock y publica `stock_aprobado` cuando todos los productos tienen stock suficiente.
- Publica `stock_rechazado` cuando falta un producto, esta inactivo o no hay stock suficiente.
- Consume la reserva con `pedido_aprobado`.
- Libera stock con `pedido_cancelado` o `envio_rechazado`.

## Variables de entorno

- `MONGODB_URI`
- `MONGODB_DATABASE`
- `DATABASE_URL` o `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`
- `DATABASE_SCHEMA`
- `QUEUE_URL`
- `EVENTS_TOPIC_ARN`

## Desarrollo

```bash
npm ci
npm run build
npm test
```
