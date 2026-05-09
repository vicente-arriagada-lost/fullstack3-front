import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { MensajeriaService } from './mensajeria.service';
import {
  CreateMensajeriaRequest,
  Mensajeria,
  UpdateMensajeriaRequest,
} from './notificacion.types';

interface NotificacionHealthResponse {
  status: 'ok';
  service: 'notificaciones';
}

@Controller('api/notificaciones')
export class NotificacionController {
  constructor(private readonly mensajeriaService: MensajeriaService) {}

  @Get()
  getHealth(): NotificacionHealthResponse {
    return {
      status: 'ok',
      service: 'notificaciones',
    };
  }

  @Post('mensajeria')
  createMensaje(@Body() body: CreateMensajeriaRequest): Promise<Mensajeria> {
    return this.mensajeriaService.create(body);
  }

  @Get('mensajeria/:id_mensaje')
  getMensaje(@Param('id_mensaje') idMensaje: string): Promise<Mensajeria> {
    return this.mensajeriaService.getById(idMensaje);
  }

  @Patch('mensajeria/:id_mensaje')
  updateMensaje(
    @Param('id_mensaje') idMensaje: string,
    @Body() body: UpdateMensajeriaRequest,
  ): Promise<Mensajeria> {
    return this.mensajeriaService.update(idMensaje, body);
  }

  @Delete('mensajeria/:id_mensaje')
  deleteMensaje(@Param('id_mensaje') idMensaje: string): Promise<Mensajeria> {
    return this.mensajeriaService.delete(idMensaje);
  }
}
