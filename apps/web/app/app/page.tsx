'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { api } from '../../lib/api';
import { APPOINTMENT_STATUS, errorMessage, statusOf } from '../../lib/labels';
import { Badge, Card, EmptyState, ErrorNote, PageHeader, buttonClass, buttonGhost, money } from '../../lib/ui';

// Inicio del panel (fase 1 auditoria de paneles 2026-09-05): accesos rapidos
// a lo que se hace cada hora, guia de primeros pasos para un negocio nuevo, y
// errores visibles (antes una API caida dejaba seis huecos sin explicacion).

interface TenantInfo {
  legalName: string;
  tradeName: string | null;
  currentPlan: { name: string } | null;
}
interface EffectiveFeature {
  code: string;
  name: string;
  enabled: boolean;
  source: string;
}
interface Dashboard {
  timezone: string;
  today: {
    count: number;
    appointments: {
      id: string;
      starts_at: string;
      status: string;
      customer_id: string;
      customer: string;
      service: string | null;
      employee: string | null;
    }[];
  };
  week_appointments: number;
  customers: { total: number; new_this_month: number };
  invoices_month: { issued: number; total: string; paid: string };
  tasks: { pending: number; overdue: number };
  inbox: { needs_human: number };
}
interface Paso {
  key: string;
  titulo: string;
  detalle: string;
  href: string;
  hecho: boolean;
}

function Kpi({ title, value, note, href, alert }: { title: string; value: string; note?: string; href: string; alert?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 shadow-sm transition hover:shadow-md ${alert ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-white'}`}
    >
      <p className="text-xs text-slate-500">{title}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${alert ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
      {note && <p className={`mt-1 text-xs ${alert ? 'text-red-600' : 'text-slate-400'}`}>{note}</p>}
    </Link>
  );
}

export default function TenantHome() {
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [features, setFeatures] = useState<EffectiveFeature[]>([]);
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pasos, setPasos] = useState<Paso[] | null>(null);

  useEffect(() => {
    void api<TenantInfo>('/tenant').then(setTenant).catch(() => undefined);
    void api<EffectiveFeature[]>('/tenant/features').then(setFeatures).catch(() => undefined);
    api<Dashboard>('/dashboard')
      .then(setDash)
      .catch((e) => setError(errorMessage(e, 'No se pudieron cargar los números del negocio. Revisá la conexión y recargá la página.')));
  }, []);

  // Negocio recien creado (sin clientes ni turnos): guia de primeros pasos
  // con el estado real de cada uno.
  useEffect(() => {
    if (!dash || dash.customers.total > 0 || dash.week_appointments > 0 || dash.today.count > 0) {
      setPasos(null);
      return;
    }
    void (async () => {
      const [servicios, empleados, integraciones, sucursales] = await Promise.all([
        api<unknown[]>('/catalog/services').catch(() => []),
        api<{ bookable: boolean; isActive: boolean }[]>('/employees').catch(() => []),
        api<{ type: string; configured: boolean }[]>('/integrations').catch(() => []),
        api<{ id: string; schedule: unknown }[]>('/branches').catch(() => []),
      ]);
      const horario = sucursales[0]?.schedule;
      setPasos([
        {
          key: 'catalogo',
          titulo: 'Cargá tu catálogo',
          detalle: 'Servicios y productos con precio: es lo que el bot responde y lo que se agenda.',
          href: '/app/catalog',
          hecho: servicios.length > 0,
        },
        {
          key: 'horarios',
          titulo: 'Definí los horarios de atención',
          detalle: 'Días y franjas en las que se pueden dar turnos.',
          href: '/app/schedule?horarios=1',
          hecho: Boolean(horario && typeof horario === 'object' && Object.keys(horario as object).length > 0),
        },
        {
          key: 'empleados',
          titulo: 'Cargá a quienes atienden',
          detalle: 'Cada turno queda asignado a una persona; el cliente puede elegir con quién.',
          href: '/app/employees',
          hecho: empleados.some((e) => e.bookable && e.isActive),
        },
        {
          key: 'whatsapp',
          titulo: 'Conectá WhatsApp (o el chat de prueba)',
          detalle: 'Con un identificador de prueba ya podés hablar con tu bot como si fueras un cliente.',
          href: '/app/settings/whatsapp',
          hecho: integraciones.some((i) => i.type === 'whatsapp' && i.configured),
        },
        {
          key: 'probar',
          titulo: 'Probá el bot',
          detalle: 'Desde la bandeja de chat, escribile y mirá cómo responde y agenda.',
          href: '/app/inbox',
          hecho: false,
        },
      ]);
    })();
  }, [dash]);

  function hora(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, {
      timeZone: dash?.timezone ?? 'America/Asuncion',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={tenant?.tradeName ?? tenant?.legalName ?? '…'}
        description={
          tenant?.currentPlan ? (
            <span className="inline-flex items-center gap-2">
              Plan {tenant.currentPlan.name}
              <Link className="text-sky-700 hover:underline" href="/app/settings/empresa">
                ver funciones incluidas
              </Link>
            </span>
          ) : undefined
        }
        actions={
          <>
            <Link className={buttonClass} href="/app/schedule?nuevo=1">
              Nuevo turno
            </Link>
            <Link className={buttonGhost} href="/app/customers?nuevo=1">
              Nuevo cliente
            </Link>
            <Link className={buttonGhost} href="/app/invoices?nueva=1">
              Nueva factura
            </Link>
            <Link className={buttonGhost} href="/app/tasks?nueva=1">
              Nueva tarea
            </Link>
          </>
        }
      />
      <ErrorNote error={error} />

      {pasos && (
        <Card
          tone="sky"
          title="Primeros pasos"
          description="Tu negocio está recién creado. Con estos cinco pasos el bot ya atiende y agenda solo."
        >
          <ol className="space-y-2">
            {pasos.map((p, i) => (
              <li key={p.key} className="flex items-start gap-3 text-sm">
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    p.hecho ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {p.hecho ? '✓' : i + 1}
                </span>
                <div className="flex-1">
                  <Link href={p.href} className={`font-medium hover:underline ${p.hecho ? 'text-slate-500 line-through' : 'text-sky-800'}`}>
                    {p.titulo}
                  </Link>
                  <p className="text-xs text-slate-500">{p.detalle}</p>
                </div>
                {!p.hecho && (
                  <Link className={buttonGhost} href={p.href}>
                    Ir
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {dash && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Kpi title="Turnos hoy" value={String(dash.today.count)} href="/app/schedule" />
          <Kpi title="Turnos próximos 7 días" value={String(dash.week_appointments)} href="/app/schedule" />
          <Kpi
            title="Tareas pendientes"
            value={String(dash.tasks.pending)}
            note={dash.tasks.overdue > 0 ? `${dash.tasks.overdue} vencida${dash.tasks.overdue === 1 ? '' : 's'}` : undefined}
            alert={dash.tasks.overdue > 0}
            href={dash.tasks.overdue > 0 ? '/app/tasks?vista=vencidas' : '/app/tasks'}
          />
          <Kpi
            title="Chats esperando una persona"
            value={String(dash.inbox.needs_human)}
            alert={dash.inbox.needs_human > 0}
            href={dash.inbox.needs_human > 0 ? '/app/inbox?humano=1' : '/app/inbox'}
          />
          <Kpi
            title="Clientes"
            value={String(dash.customers.total)}
            note={dash.customers.new_this_month > 0 ? `+${dash.customers.new_this_month} este mes` : undefined}
            href="/app/customers"
          />
          <Kpi
            title="Facturado este mes"
            value={money(dash.invoices_month.total)}
            note={`${dash.invoices_month.issued} factura${dash.invoices_month.issued === 1 ? '' : 's'} · cobrado ${money(dash.invoices_month.paid)}`}
            href="/app/invoices"
          />
        </div>
      )}

      {dash && (
        <Card
          title="Agenda de hoy"
          actions={
            <Link className="text-xs font-medium text-sky-700 hover:underline" href="/app/schedule">
              Ver agenda completa →
            </Link>
          }
        >
          {dash.today.appointments.length === 0 ? (
            <EmptyState
              title="Sin turnos para hoy"
              description="Cuando entre uno por WhatsApp o lo cargues a mano, aparece acá."
              action={
                <Link className={buttonGhost} href="/app/schedule?nuevo=1">
                  Agendar un turno
                </Link>
              }
              className="border-0 py-6"
            />
          ) : (
            <ul className="divide-y divide-slate-100">
              {dash.today.appointments.map((a) => {
                const st = statusOf(APPOINTMENT_STATUS, a.status);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <span className="w-14 font-medium tabular-nums">{hora(a.starts_at)}</span>
                    <Link className="text-sky-700 hover:underline" href={`/app/customers/${a.customer_id}`}>
                      {a.customer}
                    </Link>
                    {a.service && <span className="text-slate-500">· {a.service}</span>}
                    {a.employee && <span className="text-xs text-slate-400">atiende {a.employee}</span>}
                    <Badge tone={st.tone} className="ml-auto">
                      {st.label}
                    </Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {features.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-slate-700">
            Funciones de tu plan{' '}
            <span className="font-normal text-slate-400">
              ({features.filter((f) => f.enabled).length} de {features.length} activas)
            </span>
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {features.map((f) => (
              <span
                key={f.code}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                  f.enabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-400'
                }`}
              >
                {f.enabled ? '✓' : '—'} {f.name}
                {f.source === 'override' && <span className="text-[10px] text-emerald-600">(acuerdo especial)</span>}
              </span>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Para sumar una función que tu plan no incluye, hablá con quien te vendió el sistema.
          </p>
        </details>
      )}
    </div>
  );
}
