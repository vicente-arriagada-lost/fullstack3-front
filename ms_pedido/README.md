# ms_pedido

Microservicio NestJS/Express en TypeScript para gestionar pedidos.

## Endpoints

- `GET /` health check.
- `POST /api/pedidos` crea un pedido con su trazabilidad inicial.
- `PATCH /api/pedidos/:id_pedido` edita solo la direccion de despacho.
- `PATCH /api/pedidos/:id_pedido/cancelar` marca el pedido como cancelado.
- `GET /api/pedidos/:id_pedido/estado` obtiene el estado del pedido.

## Variables de entorno

- `PORT`: puerto HTTP. Default `3000`.
- `DATABASE_URL`: URL PostgreSQL completa.
- `DATABASE_SCHEMA`: schema PostgreSQL a usar. Default `public`. Los previews usan `pr_<numero>`.
- `QUEUE_URL`: URL de la cola SQS donde consume `stock_aprobado`, `stock_rechazado` y `envio_finalizado`.
- `EVENTS_TOPIC_ARN`: ARN del topico SNS donde se publican `pedido_creado`, `pedido_actualizado`, `pedido_cancelado`, `pedido_aprobado` y `pedido_finalizado`.

Tambien se soportan `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USER` y `DATABASE_PASSWORD`.

## Desarrollo

### Body de creacion de pedido

```json
{
  "productos": [{ "id_producto": "sku-1", "cantidad": 2 }],
  "direccion_despacho": "Av. Siempre Viva 123",
  "trazabilidad_pedido": {
    "nombre_solicitante": "Ana Perez",
    "tipo_cargo": "Compras",
    "empresa": "Smartlogix"
  }
}
```

- `npm run build` compila TypeScript estricto a `dist`.
- `npm test` compila la suite a `dist-test` y ejecuta Jest.
- `npm start` ejecuta `dist/main.js`; la imagen Docker produce ese artefacto en una etapa de build y conserva solo dependencias de produccion en runtime.

## CI/CD

- PR: crea un preview aislado con `srv-pedidos-pr-<numero>`, un Kong preview y un namespace Cloud Map `smartlogix-pr-<numero>.local`.
- Cierre de PR: elimina los recursos efimeros y ejecuta limpieza del schema `pr_<numero>`.
- `main`: despliega con canary controlado por Kong usando `pedidos` y `pedidos-canary`.
- Los cambios de pesos de Kong que hace este pipeline usan `CodeDeployDefault.ECSAllAtOnce` por defecto para no heredar el canary lento de releases reales de Kong. Se puede ajustar con `KONG_WEIGHT_DEPLOYMENT_CONFIG`.
