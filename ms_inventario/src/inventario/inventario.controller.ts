import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { InventarioService } from './inventario.service';
import { CreateProductoRequest, Producto, UpdateProductoRequest } from './inventario.types';

@Controller('api/inventario')
export class InventarioController {
  constructor(private readonly inventarioService: InventarioService) {}

  @Post()
  create(@Body() body: CreateProductoRequest): Promise<Producto> {
    return this.inventarioService.create(body);
  }

  @Patch(':id_producto')
  update(@Param('id_producto') idProducto: string, @Body() body: UpdateProductoRequest): Promise<Producto> {
    return this.inventarioService.update(idProducto, body);
  }

  @Delete(':id_producto')
  delete(
    @Param('id_producto') idProducto: string,
    @Query('nombre_responsable') nombreResponsable: string | undefined,
    @Body() body: { nombre_responsable?: unknown } = {},
  ): Promise<Producto> {
    return this.inventarioService.delete(idProducto, body.nombre_responsable ?? nombreResponsable);
  }

  @Get()
  findAll(): Promise<Producto[]> {
    return this.inventarioService.findAll();
  }
}
