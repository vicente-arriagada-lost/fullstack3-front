import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoEnvio } from '../envio.entity';

export class CreateEnvioDto {
  @ApiProperty({ example: 'uuid-pedido-123' })
  @IsString()
  @IsNotEmpty()
  pedidoId: string;

  @ApiProperty({ example: 'Av. Siempre Viva 742' })
  @IsString()
  @IsNotEmpty()
  direccionDestino: string;

  @ApiProperty({ example: 'Santiago' })
  @IsString()
  @IsNotEmpty()
  ciudadDestino: string;

  @ApiPropertyOptional({ enum: EstadoEnvio, example: EstadoEnvio.PENDIENTE })
  @IsOptional()
  @IsEnum(EstadoEnvio)
  estado?: EstadoEnvio;

  @ApiPropertyOptional({ example: 'Chilexpress' })
  @IsOptional()
  @IsString()
  transportista?: string;

  @ApiPropertyOptional({ example: 'CHX-00123' })
  @IsOptional()
  @IsString()
  codigoSeguimiento?: string;
}
