'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { api } from '../../lib/api';
import { money } from '../../lib/ui';

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
      className={`rounded-lg border p-4 transition hover:shadow-sm ${alert ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-white'}`}
    >
      <p className="text-xs text-slate-500">{title}</p>
      <p className={`mt-1 text-2xl font-semibold ${alert ? 'text-red-700' : ''}`}>{value}</p>
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
    return new Date(iso).toLocaleTimeString('es-PY', {
      timeZone: dash?.timezone ?? 'America/Asuncion',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{tenant?.tradeName ?? tenant?.legalName ?? '…'}</h1>
        <p className="text-sm text-slate-500">Plan: {tenant?.currentPlan?.name ?? '—'}</p>
      </div>

      {dash && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <Kpi title="Turnos hoy" value={String(dash.today.count)} href="/app/schedule" />
          <Kpi title="Turnos proximos 7 dias" value={String(dash.week_appointments)} href="/app/schedule" />
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
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium">Agenda de hoy</h2>
            <Link className="text-xs text-sky-700 hover:underline" href="/app/schedule">
              Ver agenda completa →
            </Link>
          </div>
          {dash.today.appointments.length === 0 ? (
            <p className="text-sm text-slate-400">Sin turnos para hoy</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {dash.today.appointments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="w-14 font-medium">{hora(a.starts_at)}</span>
                  <Link className="text-sky-700 hover:underline" href={`/app/customers/${a.customer_id}`}>
                    {a.customer}
                  </Link>
                  {a.service && <span className="text-slate-500">· {a.service}</span>}
                  {a.employee && <span className="text-xs text-slate-400">atiende {a.employee}</span>}
                  <span
                    className={`ml-auto rounded px-2 py-0.5 text-xs ${
                      a.status === 'confirmed'
                        ? 'bg-emerald-50 text-emerald-700'
                        : a.status === 'pending'
                          ? 'bg-amber-50 text-amber-700'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        {features.map((f) => (
          <div
            key={f.code}
            className={`rounded-lg border p-3 text-sm ${f.enabled ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white opacity-60'}`}
          >
            <p className="font-medium">{f.name}</p>
            <p className="text-xs text-slate-500">
              {f.enabled ? 'Habilitada' : 'No incluida en tu plan'}
              {f.source === 'override' ? ' (acuerdo)' : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
