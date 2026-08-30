'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';

import { api } from '../../../../lib/api';
import { ACTIVITY_TYPES, CONTACT_KINDS, SOURCES, type CustomFieldDef } from '../../../../lib/crm';
import { dvRuc } from '../../../../lib/ruc';
import {
  Badge,
  Card,
  ErrorNote,
  Field,
  GroupTitle,
  buttonClass,
  dt,
  inputClass,
  money,
} from '../../../../lib/ui';

interface ContactPoint {
  id: string;
  kind: string;
  label: string;
  value: string;
  isPrimary: boolean;
}
interface CustomerDetail {
  id: string;
  firstName: string;
  lastName: string | null;
  phoneE164: string | null;
  email: string | null;
  docType: string | null;
  docNumber: string | null;
  rucDv: string | null;
  birthDate: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  notifyWhatsapp: boolean;
  notifyEmail: boolean;
  marketingOptIn: boolean;
  source: string | null;
  sourceDetail: string | null;
  companyName: string | null;
  jobTitle: string | null;
  tags: string[];
  assignedUserId: string | null;
  rating: number | null;
  customData: Record<string, string | number | boolean> | null;
  lastConversationSummary: string | null;
  lastSummaryAt: string | null;
  contactPoints: ContactPoint[];
}
interface Activity {
  id: string;
  activityType: string;
  body: string;
  dueAt: string | null;
  doneAt: string | null;
  assignedUserId: string | null;
  createdAt: string;
}
interface HistoryRow {
  starts_at: string | null;
  visit_status: string | null;
  service_name: string | null;
  invoice_id: string | null;
  total: string | null;
  invoice_status: string | null;
}
interface TeamUser {
  id: string;
  fullName: string;
}

interface FormState {
  first_name: string;
  last_name: string;
  phone_e164: string;
  email: string;
  doc_type: string;
  doc_number: string;
  ruc_dv: string;
  birth_date: string;
  address: string;
  city: string;
  company_name: string;
  job_title: string;
  source: string;
  source_detail: string;
  tags: string;
  assigned_user_id: string;
  rating: number | null;
  notes: string;
  notify_whatsapp: boolean;
  notify_email: boolean;
  marketing_opt_in: boolean;
  custom: Record<string, string | boolean>;
}

function toForm(c: CustomerDetail): FormState {
  const custom: Record<string, string | boolean> = {};
  for (const [k, v] of Object.entries(c.customData ?? {})) {
    custom[k] = typeof v === 'boolean' ? v : String(v);
  }
  return {
    first_name: c.firstName,
    last_name: c.lastName ?? '',
    phone_e164: c.phoneE164 ?? '',
    email: c.email ?? '',
    doc_type: c.docType ?? '',
    doc_number: c.docNumber ?? '',
    ruc_dv: c.rucDv ?? '',
    birth_date: c.birthDate ? c.birthDate.slice(0, 10) : '',
    address: c.address ?? '',
    city: c.city ?? '',
    company_name: c.companyName ?? '',
    job_title: c.jobTitle ?? '',
    source: c.source ?? '',
    source_detail: c.sourceDetail ?? '',
    tags: (c.tags ?? []).join(', '),
    assigned_user_id: c.assignedUserId ?? '',
    rating: c.rating,
    notes: c.notes ?? '',
    notify_whatsapp: c.notifyWhatsapp,
    notify_email: c.notifyEmail,
    marketing_opt_in: c.marketingOptIn,
    custom,
  };
}

const EMPTY_CP = { kind: 'phone', label: 'celular', value: '', is_primary: false };
const EMPTY_ACT = { activity_type: 'nota', body: '', due_at: '', assigned_user_id: '' };

export default function CustomerFichaPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<CustomerDetail | null>(null);
  const [defs, setDefs] = useState<CustomFieldDef[]>([]);
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [cp, setCp] = useState(EMPTY_CP);
  const [act, setAct] = useState(EMPTY_ACT);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    void api<CustomerDetail>(`/customers/${id}`)
      .then((c) => {
        setCustomer(c);
        setForm(toForm(c));
      })
      .catch((e) => setError(String(e.message)));
    void api<Activity[]>(`/customers/${id}/activities`).then(setActivities).catch(() => undefined);
    void api<HistoryRow[]>(`/customers/${id}/history`).then(setHistory).catch(() => undefined);
  }, [id]);

  useEffect(() => {
    load();
    void api<CustomFieldDef[]>('/custom-fields?entity=customer')
      .then((all) => setDefs(all.filter((d) => d.isActive && d.showInForm)))
      .catch(() => undefined);
    // Solo root/admin pueden listar usuarios: para staff el selector queda vacio.
    void api<TeamUser[]>('/users').then(setUsers).catch(() => setUsers([]));
  }, [load, id]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setSaved(false);
    const clear = (v: string) => v.trim() || null;
    const custom_data: Record<string, string | number | boolean> = {};
    for (const def of defs) {
      const raw = form.custom[def.code];
      if (raw === undefined || raw === '') continue;
      if (def.fieldType === 'boolean') custom_data[def.code] = raw === true;
      else if (def.fieldType === 'number' || def.fieldType === 'money') custom_data[def.code] = Number(raw);
      else custom_data[def.code] = String(raw);
    }
    try {
      await api(`/customers/${id}`, {
        method: 'PATCH',
        json: {
          first_name: form.first_name.trim(),
          last_name: clear(form.last_name),
          phone_e164: clear(form.phone_e164),
          email: clear(form.email),
          doc_type: clear(form.doc_type),
          doc_number: clear(form.doc_number),
          ruc_dv: form.doc_type === 'ruc' ? clear(form.ruc_dv) : null,
          birth_date: clear(form.birth_date),
          address: clear(form.address),
          city: clear(form.city),
          company_name: clear(form.company_name),
          job_title: clear(form.job_title),
          source: clear(form.source),
          source_detail: clear(form.source_detail),
          tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
          assigned_user_id: clear(form.assigned_user_id),
          rating: form.rating,
          notes: clear(form.notes),
          notify_whatsapp: form.notify_whatsapp,
          notify_email: form.notify_email,
          marketing_opt_in: form.marketing_opt_in,
          custom_data,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function addContactPoint(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api(`/customers/${id}/contact-points`, {
        method: 'POST',
        json: { ...cp, label: cp.label.trim() || 'otro', value: cp.value.trim() },
      });
      setCp(EMPTY_CP);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function makePrimary(point: ContactPoint) {
    try {
      await api(`/customers/${id}/contact-points/${point.id}`, {
        method: 'PATCH',
        json: { is_primary: true },
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function removeContactPoint(cpId: string) {
    try {
      await api(`/customers/${id}/contact-points/${cpId}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function addActivity(e: React.FormEvent) {
    e.preventDefault();
    const isTask = ACTIVITY_TYPES.find((t) => t.value === act.activity_type)?.task;
    try {
      await api(`/customers/${id}/activities`, {
        method: 'POST',
        json: {
          activity_type: act.activity_type,
          body: act.body.trim(),
          due_at: isTask && act.due_at ? new Date(act.due_at).toISOString() : undefined,
          assigned_user_id: act.assigned_user_id || undefined,
        },
      });
      setAct(EMPTY_ACT);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function toggleDone(a: Activity) {
    try {
      await api(`/customers/${id}/activities/${a.id}`, {
        method: 'PATCH',
        json: { done: !a.doneAt },
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  async function removeActivity(aId: string) {
    if (!confirm('Borrar esta entrada del historial?')) return;
    try {
      await api(`/customers/${id}/activities/${aId}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error');
    }
  }

  function userName(userId: string | null): string | null {
    if (!userId) return null;
    return users.find((u) => u.id === userId)?.fullName ?? null;
  }

  if (!customer || !form) {
    return (
      <div className="space-y-4">
        <Link className="text-sm text-sky-700 hover:underline" href="/app/customers">
          ← Clientes
        </Link>
        <ErrorNote error={error} />
        {!error && <p className="text-sm text-slate-400">Cargando ficha…</p>}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Link className="text-sm text-sky-700 hover:underline" href="/app/customers">
          ← Clientes
        </Link>
        <h1 className="text-xl font-semibold text-slate-900">
          {customer.firstName} {customer.lastName}
        </h1>
        {/* Rating editable: clic en la estrella fija el valor; clic en la misma lo quita */}
        <span className="text-lg">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              title={`Rating ${n}`}
              className={n <= (form.rating ?? 0) ? 'text-amber-500' : 'text-slate-300'}
              onClick={() => setForm({ ...form, rating: form.rating === n ? null : n })}
            >
              ★
            </button>
          ))}
        </span>
        {(customer.tags ?? []).map((t) => (
          <Badge key={t} tone="sky">
            {t}
          </Badge>
        ))}
        {saved && <span className="text-sm text-emerald-600">✓ guardado</span>}
      </div>
      <ErrorNote error={error} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Datos del cliente">
            <form className="grid grid-cols-2 gap-3 md:grid-cols-4" onSubmit={(e) => void save(e)}>
              <GroupTitle>Contacto</GroupTitle>
              <Field label="Nombre *">
                <input className={inputClass} value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
              </Field>
              <Field label="Apellido">
                <input className={inputClass} value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
              </Field>
              <Field label="Celular / WhatsApp">
                <input className={inputClass} placeholder="+595971234567" value={form.phone_e164} onChange={(e) => setForm({ ...form, phone_e164: e.target.value })} />
              </Field>
              <Field label="Email">
                <input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>

              <GroupTitle>Documento y datos personales</GroupTitle>
              <Field label="Tipo de documento">
                <select
                  className={inputClass}
                  value={form.doc_type}
                  onChange={(e) => {
                    const doc_type = e.target.value;
                    setForm({ ...form, doc_type, ruc_dv: doc_type === 'ruc' ? (dvRuc(form.doc_number) ?? '') : '' });
                  }}
                >
                  <option value="">—</option>
                  <option value="ci">Cedula (CI)</option>
                  <option value="ruc">RUC</option>
                  <option value="pasaporte">Pasaporte</option>
                </select>
              </Field>
              <Field label="Numero de documento">
                <input
                  className={inputClass}
                  value={form.doc_number}
                  onChange={(e) => {
                    const doc_number = e.target.value;
                    const ruc_dv = form.doc_type === 'ruc' ? (dvRuc(doc_number) ?? '') : form.ruc_dv;
                    setForm({ ...form, doc_number, ruc_dv });
                  }}
                />
              </Field>
              {form.doc_type === 'ruc' && (
                <Field label="DV (automatico)">
                  <input className={`${inputClass} bg-slate-50`} readOnly value={form.ruc_dv} />
                </Field>
              )}
              <Field label="Fecha de nacimiento">
                <input className={inputClass} type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} />
              </Field>
              <Field label="Ciudad">
                <input className={inputClass} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
              </Field>
              <div className="col-span-2">
                <Field label="Direccion">
                  <input className={inputClass} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </Field>
              </div>
              <Field label="Empresa">
                <input className={inputClass} value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
              </Field>
              <Field label="Cargo">
                <input className={inputClass} value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
              </Field>

              <GroupTitle>Seguimiento comercial</GroupTitle>
              <Field label="Origen (de donde llego)">
                <select className={inputClass} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })}>
                  <option value="">—</option>
                  {SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Detalle del origen">
                <input className={inputClass} placeholder="Ej: campaña agosto, cliente Maria" value={form.source_detail} onChange={(e) => setForm({ ...form, source_detail: e.target.value })} />
              </Field>
              <div className="col-span-2">
                <Field label="Etiquetas (separadas por coma)">
                  <input className={inputClass} placeholder="vip, color, novia2026" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
                </Field>
              </div>
              {users.length > 0 && (
                <Field label="Responsable">
                  <select className={inputClass} value={form.assigned_user_id} onChange={(e) => setForm({ ...form, assigned_user_id: e.target.value })}>
                    <option value="">—</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="col-span-2 md:col-span-4">
                <Field label="Notas internas (alergias, preferencias, historial...)">
                  <textarea className={`${inputClass} h-20`} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                </Field>
              </div>

              {defs.length > 0 && (
                <>
                  <GroupTitle>
                    Campos propios del negocio{' '}
                    <span className="font-normal normal-case tracking-normal text-slate-400">
                      (se definen en Ajustes → Campos del cliente)
                    </span>
                  </GroupTitle>
                  {defs.map((def) => (
                    <Field key={def.code} label={`${def.label}${def.required ? ' *' : ''}`}>
                      {def.fieldType === 'boolean' ? (
                        <input
                          type="checkbox"
                          className="mt-2 h-4 w-4"
                          checked={form.custom[def.code] === true}
                          onChange={(e) => setForm({ ...form, custom: { ...form.custom, [def.code]: e.target.checked } })}
                        />
                      ) : def.fieldType === 'list' ? (
                        <select
                          className={inputClass}
                          required={def.required}
                          value={String(form.custom[def.code] ?? '')}
                          onChange={(e) => setForm({ ...form, custom: { ...form.custom, [def.code]: e.target.value } })}
                        >
                          <option value="">—</option>
                          {def.options.map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className={inputClass}
                          required={def.required}
                          type={def.fieldType === 'number' || def.fieldType === 'money' ? 'number' : def.fieldType === 'date' ? 'date' : def.fieldType === 'url' ? 'url' : 'text'}
                          value={String(form.custom[def.code] ?? '')}
                          onChange={(e) => setForm({ ...form, custom: { ...form.custom, [def.code]: e.target.value } })}
                        />
                      )}
                    </Field>
                  ))}
                </>
              )}

              <GroupTitle>Preferencias de contacto</GroupTitle>
              <div className="col-span-2 flex flex-wrap items-center gap-4 md:col-span-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.notify_whatsapp} onChange={(e) => setForm({ ...form, notify_whatsapp: e.target.checked })} />
                  Acepta avisos por WhatsApp
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.notify_email} onChange={(e) => setForm({ ...form, notify_email: e.target.checked })} />
                  Acepta avisos por email
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.marketing_opt_in} onChange={(e) => setForm({ ...form, marketing_opt_in: e.target.checked })} />
                  Acepta promociones
                </label>
                <button className={`${buttonClass} ml-auto`}>Guardar cambios</button>
              </div>
            </form>
          </Card>

          <Card
            title="Otros contactos"
            description="Telefonos, emails o redes adicionales al celular y email principales de arriba."
          >
            <ul className="space-y-1">
              {customer.contactPoints.map((point) => (
                <li key={point.id} className="flex items-center gap-2 text-sm">
                  <span className="w-20 text-xs uppercase text-slate-400">
                    {CONTACT_KINDS.find((k) => k.value === point.kind)?.label ?? point.kind}
                  </span>
                  <span className="text-xs text-slate-500">{point.label}</span>
                  <span>{point.value}</span>
                  <button
                    type="button"
                    title={point.isPrimary ? 'Principal de su tipo' : 'Marcar como principal'}
                    className={point.isPrimary ? 'text-amber-500' : 'text-slate-300 hover:text-amber-400'}
                    onClick={() => (point.isPrimary ? undefined : void makePrimary(point))}
                  >
                    ★
                  </button>
                  <button type="button" className="ml-auto text-xs text-red-600 hover:underline" onClick={() => void removeContactPoint(point.id)}>
                    Quitar
                  </button>
                </li>
              ))}
              {customer.contactPoints.length === 0 && <li className="text-sm text-slate-400">Sin contactos adicionales</li>}
            </ul>
            <form className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3" onSubmit={(e) => void addContactPoint(e)}>
              <Field label="Tipo">
                <select className={inputClass} value={cp.kind} onChange={(e) => setCp({ ...cp, kind: e.target.value })}>
                  {CONTACT_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Etiqueta">
                <input className={inputClass} list="cp-labels" value={cp.label} onChange={(e) => setCp({ ...cp, label: e.target.value })} />
              </Field>
              <datalist id="cp-labels">
                {['celular', 'trabajo', 'casa', 'whatsapp', 'instagram', 'facebook', 'telegram', 'web', 'otro'].map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
              <div className="min-w-[180px] flex-1">
                <Field label="Valor">
                  <input className={inputClass} placeholder="+59521..., @usuario, https://..." value={cp.value} onChange={(e) => setCp({ ...cp, value: e.target.value })} required />
                </Field>
              </div>
              <button className={buttonClass}>Agregar</button>
            </form>
          </Card>

          <Card title="Historial de visitas y facturas">
            <div className="-mx-4 -mb-4 overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Servicio</th>
                    <th>Visita</th>
                    <th>Factura</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={i}>
                      <td>{dt(h.starts_at)}</td>
                      <td>{h.service_name ?? '—'}</td>
                      <td>{h.visit_status ?? '—'}</td>
                      <td>{h.invoice_id ? `${money(h.total ?? 0)} (${h.invoice_status})` : '—'}</td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-slate-400">
                        Sin visitas ni facturas todavia
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          {customer.lastConversationSummary && (
            <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 shadow-sm">
              <p className="text-xs font-medium text-violet-800">
                Resumen de la ultima conversacion
                {customer.lastSummaryAt ? ` (${dt(customer.lastSummaryAt)})` : ''}
              </p>
              <p className="mt-1 whitespace-pre-line text-sm text-slate-700">{customer.lastConversationSummary}</p>
            </section>
          )}

          <Card title="Notas y tareas">
            <form className="space-y-2" onSubmit={(e) => void addActivity(e)}>
              <div className="flex gap-2">
                <select className={inputClass} value={act.activity_type} onChange={(e) => setAct({ ...act, activity_type: e.target.value })}>
                  {ACTIVITY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {ACTIVITY_TYPES.find((t) => t.value === act.activity_type)?.task && (
                  <input className={inputClass} type="datetime-local" value={act.due_at} onChange={(e) => setAct({ ...act, due_at: e.target.value })} />
                )}
              </div>
              {users.length > 0 && ACTIVITY_TYPES.find((t) => t.value === act.activity_type)?.task && (
                <select className={inputClass} value={act.assigned_user_id} onChange={(e) => setAct({ ...act, assigned_user_id: e.target.value })}>
                  <option value="">Responsable: nadie</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <input className={inputClass} placeholder="Escribi la nota o tarea…" value={act.body} onChange={(e) => setAct({ ...act, body: e.target.value })} required />
                <button className={buttonClass}>+</button>
              </div>
            </form>
            <ul className="mt-3 space-y-2">
              {activities.map((a) => {
                const isTask = ACTIVITY_TYPES.find((t) => t.value === a.activityType)?.task;
                const overdue = isTask && !a.doneAt && a.dueAt && new Date(a.dueAt) < new Date();
                return (
                  <li key={a.id} className={`rounded-md border p-2 text-sm ${overdue ? 'border-red-200 bg-red-50/50' : 'border-slate-100 bg-slate-50/50'}`}>
                    <div className="flex items-center gap-2">
                      {isTask && (
                        <input type="checkbox" title={a.doneAt ? 'Reabrir' : 'Marcar hecha'} checked={Boolean(a.doneAt)} onChange={() => void toggleDone(a)} />
                      )}
                      <span className="text-xs font-medium uppercase text-slate-400">
                        {ACTIVITY_TYPES.find((t) => t.value === a.activityType)?.label ?? a.activityType}
                      </span>
                      {a.dueAt && (
                        <span className={`text-xs ${overdue ? 'font-medium text-red-600' : 'text-slate-500'}`}>vence {dt(a.dueAt)}</span>
                      )}
                      <button type="button" className="ml-auto text-xs text-slate-400 hover:text-red-600" onClick={() => void removeActivity(a.id)}>
                        ×
                      </button>
                    </div>
                    <p className={`mt-1 whitespace-pre-line ${a.doneAt && isTask ? 'text-slate-400 line-through' : ''}`}>{a.body}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {dt(a.createdAt)}
                      {userName(a.assignedUserId) ? ` · ${userName(a.assignedUserId)}` : ''}
                    </p>
                  </li>
                );
              })}
              {activities.length === 0 && <li className="text-sm text-slate-400">Sin notas todavia</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
