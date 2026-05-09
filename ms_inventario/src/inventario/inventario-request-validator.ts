import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
import { CreateProductoRequest, ProductoStock, ProductoUpdateFields, UpdateProductoRequest } from './inventario.types';

const ID_PRODUCTO_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

@Injectable()
export class InventarioRequestValidator {
  validateCreateRequest(body: CreateProductoRequest = {}, now: Date) {
    this.ensurePlainObject(body, 'El body del producto es requerido.');

    const idProducto = this.getOptionalText(body.id_producto, 'id_producto');
    const nombre = this.getRequiredText(body.nombre, 'nombre');
    const tipo = this.getRequiredText(body.tipo, 'tipo');
    const stock = this.getRequiredStock(body.stock);
    const atributos = this.getOptionalRecord(body.atributos, 'atributos') ?? {};
    const nombreResponsable = this.getRequiredText(body.nombre_responsable, 'nombre_responsable');

    return {
      producto: {
        id_producto: idProducto ?? randomUUID(),
        nombre,
        tipo,
        stock,
        atributos,
        activo: true,
        fecha_creacion: now,
        fecha_actualizacion: now,
      },
      nombreResponsable,
    };
  }

  validateUpdateRequest(body: UpdateProductoRequest = {}): {
    fields: ProductoUpdateFields;
    nombreResponsable: string;
  } {
    this.ensurePlainObject(body, 'El body de actualizacion es requerido.');
    const nombreResponsable = this.getRequiredText(body.nombre_responsable, 'nombre_responsable');
    const fields: ProductoUpdateFields = {};

    if (body.nombre !== undefined) {
      fields.nombre = this.getRequiredText(body.nombre, 'nombre');
    }
    if (body.tipo !== undefined) {
      fields.tipo = this.getRequiredText(body.tipo, 'tipo');
    }
    if (body.stock !== undefined) {
      fields.stock = this.getRequiredStock(body.stock);
    }
    if (body.atributos !== undefined) {
      fields.atributos = this.getOptionalRecord(body.atributos, 'atributos') ?? {};
    }
    if (body.activo !== undefined) {
      if (typeof body.activo !== 'boolean') {
        throw new BadRequestException('activo debe ser boolean.');
      }
      fields.activo = body.activo;
    }

    if (Object.keys(fields).length === 0) {
      throw new BadRequestException('Debe indicar al menos un campo de producto para actualizar.');
    }

    return { fields, nombreResponsable };
  }

  validateIdProducto(idProducto: string): string {
    const value = this.getRequiredText(idProducto, 'id_producto');
    if (!ID_PRODUCTO_PATTERN.test(value)) {
      throw new BadRequestException('id_producto debe usar solo letras, numeros, punto, guion, guion bajo o dos puntos.');
    }
    return value;
  }

  validateNombreResponsable(value: unknown): string {
    return this.getRequiredText(value, 'nombre_responsable');
  }

  private getRequiredText(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} debe ser texto no vacio.`);
    }
    return value.trim();
  }

  private getOptionalText(value: unknown, fieldName: string): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return this.getRequiredText(value, fieldName);
  }

  private getRequiredStock(value: unknown): ProductoStock {
    this.ensurePlainObject(value, 'stock debe ser un objeto.');
    const cantidadDisponible = (value as { cantidad_disponible?: unknown }).cantidad_disponible;
    const cantidadReservada = (value as { cantidad_reservada?: unknown }).cantidad_reservada ?? 0;

    if (!Number.isInteger(cantidadDisponible) || Number(cantidadDisponible) < 0) {
      throw new BadRequestException('stock.cantidad_disponible debe ser entero mayor o igual a 0.');
    }
    if (!Number.isInteger(cantidadReservada) || Number(cantidadReservada) < 0) {
      throw new BadRequestException('stock.cantidad_reservada debe ser entero mayor o igual a 0.');
    }

    return {
      cantidad_disponible: Number(cantidadDisponible),
      cantidad_reservada: Number(cantidadReservada),
    };
  }

  private getOptionalRecord(value: unknown, fieldName: string): Record<string, unknown> | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }
    this.ensurePlainObject(value, `${fieldName} debe ser un objeto.`);
    return value as Record<string, unknown>;
  }

  private ensurePlainObject(value: unknown, message: string): asserts value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException(message);
    }
  }
}
