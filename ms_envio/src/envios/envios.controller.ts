// Controlador que expone los endpoints REST del CRUD de envios.
// Todos los endpoints quedan bajo /api/envios gracias al prefijo global definido en main.ts.
import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EnviosService } from './envios.service';
import { CreateEnvioDto } from './dto/create-envio.dto';
import { UpdateEnvioDto } from './dto/update-envio.dto';

@ApiTags('envios')
@Controller('envios')
export class EnviosController {
  constructor(private readonly enviosService: EnviosService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un nuevo envio' })
  @ApiResponse({ status: 201, description: 'Envio creado exitosamente' })
  create(@Body() createEnvioDto: CreateEnvioDto) {
    return this.enviosService.create(createEnvioDto);
  }

  @Get()
  @ApiOperation({ summary: 'Obtener todos los envios' })
  @ApiResponse({ status: 200, description: 'Lista de envios' })
  findAll() {
    return this.enviosService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener un envio por ID' })
  @ApiResponse({ status: 200, description: 'Envio encontrado' })
  @ApiResponse({ status: 404, description: 'Envio no encontrado' })
  findOne(@Param('id') id: string) {
    return this.enviosService.findOne(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar un envio' })
  @ApiResponse({ status: 200, description: 'Envio actualizado' })
  @ApiResponse({ status: 404, description: 'Envio no encontrado' })
  update(@Param('id') id: string, @Body() updateEnvioDto: UpdateEnvioDto) {
    return this.enviosService.update(id, updateEnvioDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar un envio' })
  @ApiResponse({ status: 200, description: 'Envio eliminado' })
  @ApiResponse({ status: 404, description: 'Envio no encontrado' })
  remove(@Param('id') id: string) {
    return this.enviosService.remove(id);
  }
}
