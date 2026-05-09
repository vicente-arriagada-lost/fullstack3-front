# ms_notificacion

Microservicio NestJS en TypeScript para registrar notificaciones derivadas de eventos.

## Comportamiento

- Consume mensajes desde SQS usando `QUEUE_URL`.
- Cuando recibe `envio_aprobado`, `envio_rechazado`, `envio_atrasado` o `pedido_finalizado`, inserta un registro en la tabla `notificacion`.
- Registra `tipo_notificacion`, `mensaje`, `id_pedido` cuando el evento lo incluye, estado y fecha.
- El estado inicial es `sin entregar`.
- La fecha se resuelve en PostgreSQL con `NOW()`.
- La PK se genera como UUID.
- `notificacion.id_pedido` es opcional y referencia al pedido cuando ambas tablas existen en la misma base y schema PostgreSQL.

## Variables de entorno

- `PORT`: puerto HTTP. Default `3000`.
- `DATABASE_URL`: URL PostgreSQL completa.
- `DATABASE_SCHEMA`: schema PostgreSQL a usar. Default `public`.
- `QUEUE_URL`: URL de la cola SQS del microservicio.

Tambien se soportan `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER` y `DATABASE_PASSWORD`.

## Desarrollo

- `npm run build` compila TypeScript estricto a `dist`.
- `npm test` compila la suite a `dist-test` y ejecuta Jest.
- `npm start` ejecuta `dist/main.js`.

## CI/CD

- PR: crea un preview aislado con `srv-notificaciones-pr-<numero>`, una cola SQS preview, suscripciones SNS filtradas a los eventos de notificacion, un schema `pr_<numero>` y un Kong preview para smoke tests.
- Cierre de PR: elimina ECS/Kong preview, cola SQS, suscripcion SNS y schema efimero.
- `main`: construye la imagen, la publica en ECR y despliega ECS con promocion estable/canary coherente con el gateway.
