import { IsString, IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoEnvio } from '../envio.entity';

export class UpdateEnvioDto {
  @ApiPropertyOptional({ example: 'Av. Nueva 123' })
  @IsOptional()
  @IsString()
  direccionDestino?: string;

  @ApiPropertyOptional({ example: 'Valparaiso' })
  @IsOptional()
  @IsString()
  ciudadDestino?: string;

  @ApiPropertyOptional({ enum: EstadoEnvio, example: EstadoEnvio.EN_TRANSITO })
  @IsOptional()
  @IsEnum(EstadoEnvio)
  estado?: EstadoEnvio;

  @ApiPropertyOptional({ example: 'Starken' })
  @IsOptional()
  @IsString()
  transportista?: string;

  @ApiPropertyOptional({ example: 'STK-00456' })
  @IsOptional()
  @IsString()
  codigoSeguimiento?: string;
}
