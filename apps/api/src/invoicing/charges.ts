import type { TenantTx } from '@pymes/db';

/**
 * Cuenta mensual (2026-09-07): al marcar un turno como atendido, si el
 * cliente factura por cuenta mensual, cada servicio del turno pasa a ser un
 * consumo pendiente con el precio del catalogo de ese momento. Idempotente:
 * un turno genera consumos una sola vez. Devuelve cuantos creo.
 */
export async function crearConsumosDeTurno(tx: TenantTx, tenantId: string, appointmentId: string): Promise<number> {
  const appt = await tx.appointment.findFirst({
    where: { id: appointmentId },
    include: {
      customer: { select: { id: true, billingMode: true } },
      services: { orderBy: { sort: 'asc' }, include: { service: { select: { id: true, name: true, price: true, taxRate: true } } } },
      service: { select: { id: true, name: true, price: true, taxRate: true } },
    },
  });
  if (!appt || appt.customer.billingMode !== 'monthly') return 0;
  const existentes = await tx.customerCharge.count({ where: { appointmentId } });
  if (existentes > 0) return 0;
  const servicios = appt.services.length > 0 ? appt.services.map((s) => s.service) : appt.service ? [appt.service] : [];
  if (servicios.length === 0) return 0;
  const chargedOn = appt.startsAt;
  await tx.customerCharge.createMany({
    data: servicios.map((s) => ({
      tenantId,
      customerId: appt.customerId,
      serviceId: s.id,
      appointmentId,
      description: s.name,
      quantity: 1,
      unitPrice: s.price,
      taxRate: s.taxRate,
      lineTotal: s.price,
      source: 'appointment',
      chargedOn,
    })),
  });
  return servicios.length;
}
