import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Envio, EstadoEnvio } from './envio.entity';
import { CreateEnvioDto } from './dto/create-envio.dto';
import { UpdateEnvioDto } from './dto/update-envio.dto';
import { EnvioEventPublisher } from './envio-event-publisher';

@Injectable()
export class EnviosService {
  constructor(
    @InjectRepository(Envio)
    private readonly envioRepository: Repository<Envio>,
    private readonly publisher: EnvioEventPublisher,
  ) {}

  create(createEnvioDto: CreateEnvioDto): Promise<Envio> {
    const envio = this.envioRepository.create(createEnvioDto);
    return this.envioRepository.save(envio);
  }

  findAll(): Promise<Envio[]> {
    return this.envioRepository.find();
  }

  async findOne(id: string): Promise<Envio> {
    const envio = await this.envioRepository.findOneBy({ id });
    if (!envio) throw new NotFoundException(`Envio con id ${id} no encontrado`);
    return envio;
  }

  findByPedidoId(pedidoId: string): Promise<Envio[]> {
    return this.envioRepository.findBy({ pedidoId });
  }

  async createDesdePedidoAprobado(pedidoId: string, direccionDestino: string, ciudadDestino: string): Promise<Envio> {
    const envio = await this.create({ pedidoId, direccionDestino, ciudadDestino });
    await this.publisher.publishEnvioPendiente(envio);
    return envio;
  }

  async update(id: string, updateEnvioDto: UpdateEnvioDto): Promise<Envio> {
    const envio = await this.findOne(id);
    const estadoAnterior = envio.estado;
    Object.assign(envio, updateEnvioDto);
    const saved = await this.envioRepository.save(envio);

    if (updateEnvioDto.estado && updateEnvioDto.estado !== estadoAnterior) {
      if (saved.estado === EstadoEnvio.EN_TRANSITO) {
        await this.publisher.publishEnvioAprobado(saved);
      } else if (saved.estado === EstadoEnvio.CANCELADO) {
        await this.publisher.publishEnvioRechazado(saved);
      } else if (saved.estado === EstadoEnvio.ENTREGADO) {
        await this.publisher.publishEnvioFinalizado(saved);
      }
    }

    return saved;
  }

  async remove(id: string): Promise<void> {
    const envio = await this.findOne(id);
    await this.envioRepository.remove(envio);
  }
}
