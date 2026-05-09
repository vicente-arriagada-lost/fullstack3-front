// Entidad que representa un envio en la base de datos PostgreSQL.
// Cada envio esta asociado a un pedido y tiene un estado que va cambiando durante el proceso logistico.
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Estados posibles de un envio
export enum EstadoEnvio {
  PENDIENTE = 'pendiente',
  EN_TRANSITO = 'en_transito',
  ENTREGADO = 'entregado',
  CANCELADO = 'cancelado',
}

@Entity('envios')
export class Envio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  pedidoId: string;

  @Column()
  direccionDestino: string;

  @Column()
  ciudadDestino: string;

  @Column({ type: 'enum', enum: EstadoEnvio, default: EstadoEnvio.PENDIENTE })
  estado: EstadoEnvio;

  @Column({ nullable: true })
  transportista: string;

  @Column({ nullable: true })
  codigoSeguimiento: string;

  @CreateDateColumn()
  creadoEn: Date;

  @UpdateDateColumn()
  actualizadoEn: Date;
}
