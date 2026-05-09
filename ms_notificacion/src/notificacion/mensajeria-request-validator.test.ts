import { BadRequestException } from '@nestjs/common';
import { MensajeriaRequestValidator } from './mensajeria-request-validator';

describe('MensajeriaRequestValidator', () => {
  const validator = new MensajeriaRequestValidator();
  const body = {
    asunto: 'Despacho',
    cuerpo: 'Pedido listo',
    responsable: 'Operaciones',
    fecha_envio: '2026-05-02T12:00:00.000Z',
    destinatarios: ['CLIENTE@example.com'],
  };

  test('valida body de creacion y normaliza datos', () => {
    const mensaje = validator.validateCreateRequest(body, 'c09d1c90-6294-4a8b-b4d7-3e98e2dc89df');

    expect(mensaje).toEqual({
      id_mensaje: 'c09d1c90-6294-4a8b-b4d7-3e98e2dc89df',
      asunto: 'Despacho',
      cuerpo: 'Pedido listo',
      responsable: 'Operaciones',
      fecha_envio: new Date('2026-05-02T12:00:00.000Z'),
      destinatarios: ['cliente@example.com'],
    });
  });

  test('rechaza destinatarios vacios', () => {
    expect(() => validator.validateCreateRequest({ ...body, destinatarios: [] }, 'id')).toThrow(
      BadRequestException,
    );
  });

  test('rechaza correos invalidos', () => {
    expect(() =>
      validator.validateCreateRequest({ ...body, destinatarios: ['correo-invalido'] }, 'id'),
    ).toThrow(BadRequestException);
  });

  test('rechaza update sin campos', () => {
    expect(() => validator.validateUpdateRequest({})).toThrow(BadRequestException);
  });

  test('valida update parcial', () => {
    expect(validator.validateUpdateRequest({ asunto: 'Nuevo asunto' })).toEqual({
      asunto: 'Nuevo asunto',
    });
  });
});
