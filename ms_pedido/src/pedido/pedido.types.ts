export type PedidoEstado = 'creado' | 'aprobado' | 'rechazado' | 'cancelado' | 'finalizado';

export interface PedidoProducto {
  id_producto: string;
  cantidad: number;
}

export interface Pedido {
  id_pedido: string;
  productos: PedidoProducto[];
  direccion_despacho: string;
  estado: PedidoEstado;
  fecha_hora: Date;
}

export interface TrazabilidadPedido {
  id_pedido: string;
  nombre_solicitante: string;
  tipo_cargo: string;
  empresa: string;
}

export interface PedidoConTrazabilidad extends Pedido {
  trazabilidad_pedido: Omit<TrazabilidadPedido, 'id_pedido'>;
}

export type PedidoUpdateFields = Pick<Pedido, 'direccion_despacho'>;

export type PedidoStatus = Pick<Pedido, 'id_pedido' | 'estado'>;

export interface CreatePedidoRequest {
  productos?: unknown;
  direccion_despacho?: unknown;
  trazabilidad_pedido?: unknown;
}

export interface UpdatePedidoRequest {
  productos?: unknown;
  direccion_despacho?: unknown;
}

export interface CreatePedidoData {
  pedido: Pedido;
  trazabilidadPedido: TrazabilidadPedido;
}

export interface StockEvaluadoEvent {
  evento: 'stock_aprobado' | 'stock_rechazado';
  pedido: {
    id_pedido: string;
  };
}

export interface EnvioFinalizadoEvent {
  evento: 'envio_finalizado';
  pedido?: {
    id_pedido?: unknown;
  };
  id_pedido?: unknown;
}
