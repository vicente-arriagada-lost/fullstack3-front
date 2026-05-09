# MS Envios - Smartlogix

Microservicio de gestión de envíos para la plataforma Smartlogix. Desarrollado con NestJS y PostgreSQL, desplegado en AWS ECS Fargate.

## Descripción

Este microservicio se encarga de gestionar el ciclo de vida de los envíos, desde su creación hasta la entrega. Expone una API REST bajo `/api/envios` y es accesible a través del Kong API Gateway.

## Tecnologías

- NestJS
- TypeORM
- PostgreSQL (AWS RDS)
- Swagger
- Docker
- AWS ECS Fargate

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/envios` | Crear un nuevo envio |
| GET | `/api/envios` | Obtener todos los envios |
| GET | `/api/envios/:id` | Obtener un envio por ID |
| PUT | `/api/envios/:id` | Actualizar un envio |
| DELETE | `/api/envios/:id` | Eliminar un envio |

## Estados de un envío

| Estado | Descripción |
|--------|-------------|
| `pendiente` | Envio creado, esperando despacho |
| `en_transito` | Envio en camino al destino |
| `entregado` | Envio entregado al destinatario |
| `cancelado` | Envio cancelado |

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | URL de conexión a PostgreSQL |
| `DATABASE_SSL` | Habilitar SSL para la BD (`true` en AWS) |
| `NODE_ENV` | Entorno de ejecución |
| `PORT` | Puerto del servidor (default: 3000) |

## Correr localmente

1. Conectarse a la VPN de AWS
2. Crear el archivo `.env` con las credenciales del RDS
3. Instalar dependencias:
```bash
npm install
```
4. Levantar el servidor:
```bash
npm run start:dev
```
5. Ver documentación Swagger en `http://localhost:3000/api/docs`

## CI/CD

- `pr-preview.yml` — construye y despliega una preview por cada Pull Request
- `prod-deploy.yml` — despliega a producción cuando se hace push a `main`
