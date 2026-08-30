'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { api } from '../../lib/api';
import { Badge, Card, money, type BadgeTone } from '../../lib/ui';

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
  date: string;
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

const STATUS_LABEL: Record<string, string> = {
  pending: 'a confirmar',
  confirmed: 'confirmado',
  completed: 'completado',
  no_show: 'no vino',
};

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

  useEffect(() => {
    void api<TenantInfo>('/tenant').then(setTenant).catch(() => undefined);
    void api<EffectiveFeature[]>('/tenant/features').then(setFeatures).catch(() => undefined);
    void api<Dashboard>('/dashboard').then(setDash).catch(() => undefined);
  }, []);

  function hora(iso: string): string {
    return new Date(iso).toLocaleTimeString(undefined, {
      timeZone: dash?.timezone ?? 'America/Asuncion',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const statusTone = (s: string): BadgeTone => (s === 'confirmed' ? 'emerald' : s === 'pending' ? 'amber' : 'slate');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">{tenant?.tradeName ?? tenant?.legalName ?? '…'}</h1>
        {tenant?.currentPlan && <Badge tone="sky">Plan {tenant.currentPlan.name}</Badge>}
      </div>

      {dash && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Kpi title="Turnos hoy" value={String(dash.today.count)} href="/app/schedule" />
          <Kpi title="Turnos próximos 7 días" value={String(dash.week_appointments)} href="/app/schedule" />
          <Kpi
            title="Tareas pendientes"
            value={String(dash.tasks.pending)}
            note={dash.tasks.overdue > 0 ? `${dash.tasks.overdue} vencida${dash.tasks.overdue === 1 ? '' : 's'}` : undefined}
            alert={dash.tasks.overdue > 0}
            href="/app/tasks"
          />
          <Kpi
            title="Chats esperando persona"
            value={String(dash.inbox.needs_human)}
            alert={dash.inbox.needs_human > 0}
            href="/app/inbox"
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
            <p className="py-2 text-sm text-slate-400">Sin turnos para hoy</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dash.today.appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="w-14 font-medium tabular-nums">{hora(a.starts_at)}</span>
                  <Link className="text-sky-700 hover:underline" href={`/app/customers/${a.customer_id}`}>
                    {a.customer}
                  </Link>
                  {a.service && <span className="text-slate-500">· {a.service}</span>}
                  {a.employee && <span className="text-xs text-slate-400">atiende {a.employee}</span>}
                  <Badge tone={statusTone(a.status)} className="ml-auto">
                    {STATUS_LABEL[a.status] ?? a.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card
        title="Funciones de tu plan"
        description="Lo que tu plan incluye hoy; los acuerdos a medida aparecen marcados."
      >
        <div className="flex flex-wrap gap-2">
          {features.map((f) => (
            <span
              key={f.code}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                f.enabled
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white text-slate-400'
              }`}
            >
              {f.enabled ? '✓' : '—'} {f.name}
              {f.source === 'override' && <span className="text-[10px] text-emerald-600">(acuerdo)</span>}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
