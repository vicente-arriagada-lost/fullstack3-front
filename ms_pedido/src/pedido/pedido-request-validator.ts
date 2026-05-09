import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CreatePedidoData,
  CreatePedidoRequest,
  Pedido,
  PedidoProducto,
  PedidoUpdateFields,
  TrazabilidadPedido,
  UpdatePedidoRequest,
} from './pedido.types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PedidoRequestValidator {
  validateCreateRequest(body: CreatePedidoRequest, idPedido: string, fechaHora: Date): CreatePedidoData {
    const pedido: Pedido = {
      id_pedido: idPedido,
      productos: this.validateProductos(body.productos),
      direccion_despacho: this.validateRequiredText(body.direccion_despacho, 'direccion_despacho'),
      estado: 'creado',
      fecha_hora: fechaHora,
    };

    return {
      pedido,
      trazabilidadPedido: this.validateTrazabilidadPedido(body.trazabilidad_pedido, idPedido),
    };
  }

  validateUpdateRequest(body: UpdatePedidoRequest): PedidoUpdateFields {
    if (body.productos !== undefined) {
      throw new BadRequestException('productos no se puede modificar en un pedido existente.');
    }

    if (body.direccion_despacho === undefined) {
      throw new BadRequestException('Debe indicar direccion_despacho para modificar.');
    }

    return {
      direccion_despacho: this.validateRequiredText(body.direccion_despacho, 'direccion_despacho'),
    };
  }

  validateIdPedido(idPedido: string): void {
    if (!UUID_PATTERN.test(idPedido)) {
      throw new BadRequestException('id_pedido debe ser un UUID valido.');
    }
  }

  private validateProductos(productos: unknown): PedidoProducto[] {
    if (!Array.isArray(productos) || productos.length === 0) {
      throw new BadRequestException('productos debe ser un arreglo no vacio.');
    }

    return productos.map((producto, index) => this.validateProducto(producto, index));
  }

  private validateProducto(producto: unknown, index: number): PedidoProducto {
    if (producto === null || typeof producto !== 'object' || Array.isArray(producto)) {
      throw new BadRequestException(`productos[${index}] debe ser un objeto.`);
    }

    const candidate = producto as Record<string, unknown>;

    return {
      id_producto: this.validateRequiredText(candidate.id_producto, `productos[${index}].id_producto`),
      cantidad: this.validateCantidad(candidate.cantidad, index),
    };
  }

  private validateCantidad(cantidad: unknown, index: number): number {
    if (typeof cantidad !== 'number' || !Number.isInteger(cantidad) || cantidad <= 0) {
      throw new BadRequestException(`productos[${index}].cantidad debe ser un entero mayor a 0.`);
    }

    return cantidad;
  }

  private validateTrazabilidadPedido(trazabilidadPedido: unknown, idPedido: string): TrazabilidadPedido {
    if (trazabilidadPedido === null || typeof trazabilidadPedido !== 'object' || Array.isArray(trazabilidadPedido)) {
      throw new BadRequestException('trazabilidad_pedido debe ser un objeto.');
    }

    const candidate = trazabilidadPedido as Record<string, unknown>;

    return {
      id_pedido: idPedido,
      nombre_solicitante: this.validateRequiredText(
        candidate.nombre_solicitante,
        'trazabilidad_pedido.nombre_solicitante',
      ),
      tipo_cargo: this.validateRequiredText(candidate.tipo_cargo, 'trazabilidad_pedido.tipo_cargo'),
      empresa: this.validateRequiredText(candidate.empresa, 'trazabilidad_pedido.empresa'),
    };
  }

  private validateRequiredText(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(`${fieldName} debe ser un texto no vacio.`);
    }

    return value.trim();
  }
}
