export const NOTIFICACION_EVENTOS = {
  ENVIO_APROBADO: 'envio_aprobado',
  ENVIO_RECHAZADO: 'envio_rechazado',
  ENVIO_ATRASADO: 'envio_atrasado',
  PEDIDO_FINALIZADO: 'pedido_finalizado',
} as const;

export const NOTIFICACION_MENSAJES: Record<NotificacionTipo, string> = {
  envio_aprobado: 'Envio aprobado.',
  envio_rechazado: 'Envio rechazado, solicite de nuevo.',
  envio_atrasado: 'Su envio esta atrasado.',
  pedido_finalizado: 'Pedido finalizado.',
};

export type NotificacionStatus = 'entregado' | 'sin entregar' | 'esperando revision';
export type NotificacionTipo = (typeof NOTIFICACION_EVENTOS)[keyof typeof NOTIFICACION_EVENTOS];

export interface Notificacion {
  id_notificacion: string;
  id_pedido: string | null;
  tipo_notificacion: NotificacionTipo;
  fecha: Date;
  mensaje: string;
  status: NotificacionStatus;
}

export interface NotificacionEventPayload {
  evento: NotificacionTipo;
  pedido?: {
    id_pedido?: unknown;
  };
  id_pedido?: unknown;
}

export interface Mensajeria {
  id_mensaje: string;
  asunto: string;
  cuerpo: string;
  responsable: string;
  fecha_envio: Date;
  destinatarios: string[];
}

export interface CreateMensajeriaRequest {
  asunto?: unknown;
  cuerpo?: unknown;
  responsable?: unknown;
  fecha_envio?: unknown;
  destinatarios?: unknown;
}

export type UpdateMensajeriaRequest = CreateMensajeriaRequest;

export type CreateMensajeriaData = Mensajeria;

export type MensajeriaUpdateFields = Partial<Omit<Mensajeria, 'id_mensaje'>>;
