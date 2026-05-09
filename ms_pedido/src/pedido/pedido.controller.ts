import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { PedidoService } from './pedido.service';
import { CreatePedidoRequest, Pedido, PedidoConTrazabilidad, PedidoStatus, UpdatePedidoRequest } from './pedido.types';

@Controller('api/pedidos')
export class PedidoController {
  constructor(private readonly pedidoService: PedidoService) {}

  @Post()
  create(@Body() body: CreatePedidoRequest): Promise<PedidoConTrazabilidad> {
    return this.pedidoService.create(body);
  }

  @Patch(':id_pedido')
  update(@Param('id_pedido') idPedido: string, @Body() body: UpdatePedidoRequest): Promise<Pedido> {
    return this.pedidoService.update(idPedido, body);
  }

  @Patch(':id_pedido/cancelar')
  cancel(@Param('id_pedido') idPedido: string): Promise<Pedido> {
    return this.pedidoService.cancel(idPedido);
  }

  @Get(':id_pedido/estado')
  getStatus(@Param('id_pedido') idPedido: string): Promise<PedidoStatus> {
    return this.pedidoService.getStatus(idPedido);
  }
}
