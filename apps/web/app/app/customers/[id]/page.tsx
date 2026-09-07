'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { api } from '../../../../lib/api';
import { CustomerPicker, customerName, type PickedCustomer } from '../../../../lib/customer-picker';
import { useConfirm, useToast } from '../../../../lib/feedback';
import { APPOINTMENT_STATUS, INVOICE_STATUS, errorMessage, statusOf } from '../../../../lib/labels';
import { ACTIVITY_TYPES, CONTACT_KINDS, SOURCES, type CustomFieldDef } from '../../../../lib/crm';
import { MoneyInput } from '../../../../lib/money-input';
import { dvRuc } from '../../../../lib/ruc';
import {
  Badge,
  Button,
  Card,
  ErrorNote,
  Field,
  GroupTitle,
  Modal,
  buttonGhost,
  buttonSoft,
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
/** A nombre de quien factura (2026-09-07): RUC o CI + razon social; varias por cliente. */
interface FiscalId {
  id: string;
  docType: string;
  docNumber: string;
  rucDv: string | null;
  legalName: string;
  isDefault: boolean;
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
  billingMode: string;
  invoiceChannel: string;
  contactPoints: ContactPoint[];
  fiscalIds: FiscalId[];
}
/** Consumo pendiente de la cuenta mensual (2026-09-07). */
interface Consumo {
  id: string;
  description: string;
  quantity: string;
  lineTotal: string;
  chargedOn: string;
  source: string;
}
/** Servicio recurrente (2026-09-07). */
interface Recurrente {
  id: string;
  frequency: string;
  weekday: number | null;
  dayOfMonth: number | null;
  timeLocal: string;
  durationMin: number;
  startsOn: string;
  endsOn: string | null;
  isActive: boolean;
  lastGeneratedOn: string | null;
  lastError: string | null;
  services: { id: string; name: string }[];
  employee: { id: string; firstName: string; lastName: string } | null;
}
interface ServicioOpcion {
  id: string;
  name: string;
  kind: string;
  isActive?: boolean;
  durationMin: number | null;
  comboDurationMin: number | null;
}
const DIAS_SEMANA = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const FRECUENCIA_LABEL: Record<string, string> = { weekly: 'cada semana', biweekly: 'cada dos semanas', monthly: 'cada mes' };
const CONSUMO_VACIO = { service_id: '', description: '', quantity: '1', unit_price: '', tax_rate: '10', notes: '' };
const RECURRENTE_VACIO = { service_ids: [] as string[], frequency: 'weekly', weekday: '1', day_of_month: '1', time_local: '10:00', duration_min: '', employee_id: '', starts_on: new Date().toISOString().slice(0, 10), ends_on: '', notes: '' };
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
  billing_mode: string;
  invoice_channel: string;
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
    billing_mode: c.billingMode ?? 'per_service',
    invoice_channel: c.invoiceChannel ?? 'whatsapp',
    notify_whatsapp: c.notifyWhatsapp,
    notify_email: c.notifyEmail,
    marketing_opt_in: c.marketingOptIn,
    custom,
  };
}

const EMPTY_CP = { kind: 'phone', label: 'celular', value: '', is_primary: false };
const EMPTY_ACT = { activity_type: 'nota', body: '', due_at: '', assigned_user_id: '' };

export default function CustomerFichaPage() {
  const confirmar = useConfirm();
  const toast = useToast();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [fusionar, setFusionar] = useState(false);
  const [fusionCon, setFusionCon] = useState<PickedCustomer | null>(null);
  const [guardando, setGuardando] = useState(false);
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
  // Identidades fiscales (RUC / razon social) de la ficha.
  const [fiscal, setFiscal] = useState<FiscalId | 'nueva' | null>(null);
  const [fiscalForm, setFiscalForm] = useState({ doc_type: 'ruc', doc_number: '', ruc_dv: '', legal_name: '', is_default: false });
  const [guardandoFiscal, setGuardandoFiscal] = useState(false);
  // Cuenta mensual y servicios recurrentes (2026-09-07).
  const [consumos, setConsumos] = useState<Consumo[]>([]);
  const [consumo, setConsumo] = useState<typeof CONSUMO_VACIO | null>(null);
  const [recurrentes, setRecurrentes] = useState<Recurrente[]>([]);
  const [recurrente, setRecurrente] = useState<typeof RECURRENTE_VACIO | null>(null);
  const [servicios, setServicios] = useState<ServicioOpcion[]>([]);
  const [empleados, setEmpleados] = useState<{ id: string; firstName: string; lastName: string; bookable: boolean; isActive: boolean }[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [guardandoExtra, setGuardandoExtra] = useState(false);

  const load = useCallback(() => {
    void api<CustomerDetail>(`/customers/${id}`)
      .then((c) => {
        setCustomer(c);
        setForm(toForm(c));
      })
      .catch((e) => setError(String(e.message)));
    void api<Activity[]>(`/customers/${id}/activities`).then(setActivities).catch(() => undefined);
    void api<HistoryRow[]>(`/customers/${id}/history`).then(setHistory).catch(() => undefined);
    void api<{ charges: Consumo[] }>(`/billing/accounts/${id}`).then((r) => setConsumos(r.charges)).catch(() => setConsumos([]));
    void api<Recurrente[]>(`/recurring-bookings?customer_id=${id}`).then(setRecurrentes).catch(() => setRecurrentes([]));
  }, [id]);

  useEffect(() => {
    load();
    void api<CustomFieldDef[]>('/custom-fields?entity=customer')
      .then((all) => setDefs(all.filter((d) => d.isActive && d.showInForm)))
      .catch(() => undefined);
    // Solo root/admin pueden listar usuarios: para staff el selector queda vacio.
    void api<TeamUser[]>('/users').then(setUsers).catch(() => setUsers([]));
    void api<ServicioOpcion[]>('/catalog/services').then((s) => setServicios(s.filter((x) => x.isActive !== false))).catch(() => undefined);
    void api<typeof empleados>('/employees').then((e) => setEmpleados(e.filter((x) => x.bookable && x.isActive))).catch(() => undefined);
    void api<{ id: string; isMain?: boolean }[]>('/branches').then((b) => setBranchId((b.find((x) => x.isMain) ?? b[0])?.id ?? null)).catch(() => undefined);
  }, [load, id]);

  // Cambios sin guardar: compara el formulario con lo que vino del servidor.
  const dirty = useMemo(() => Boolean(customer && form && JSON.stringify(form) !== JSON.stringify(toForm(customer))), [customer, form]);
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);
    setSaved(false);
    setGuardando(true);
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
          billing_mode: form.billing_mode,
          invoice_channel: form.invoice_channel,
          custom_data,
        },
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      toast.success('Ficha guardada');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setGuardando(false);
    }
  }

  /** El puntaje se guarda al instante: antes las estrellas estaban fuera del formulario y no persistian solas. */
  async function setRating(n: number | null) {
    if (!form) return;
    setForm({ ...form, rating: n });
    try {
      await api(`/customers/${id}`, { method: 'PATCH', json: { rating: n } });
      setCustomer((c) => (c ? { ...c, rating: n } : c));
      toast.success(n ? `Puntaje: ${n} de 5` : 'Puntaje quitado');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function desactivar() {
    if (!customer) return;
    const ok = await confirmar({
      title: `Desactivar a ${customerName(customer)}`,
      message: 'Deja de aparecer en las listas y el bot no lo usa. Su historial de turnos y facturas se conserva.',
      confirmLabel: 'Desactivar',
    });
    if (!ok) return;
    try {
      await api(`/customers/${id}`, { method: 'DELETE' });
      toast.success('Cliente desactivado');
      router.push('/app/customers');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  async function confirmarFusion() {
    if (!customer || !fusionCon) return;
    const ok = await confirmar({
      title: `Unir "${customerName(fusionCon)}" dentro de "${customerName(customer)}"`,
      message:
        'Los turnos, facturas, notas y contactos del otro registro pasan a esta ficha y el otro registro se desactiva. No se puede deshacer.',
      confirmLabel: 'Unir fichas',
    });
    if (!ok) return;
    try {
      await api(`/customers/${id}/merge`, { method: 'POST', json: { source_id: fusionCon.id } });
      toast.success('Fichas unidas');
      setFusionar(false);
      setFusionCon(null);
      load();
    } catch (e) {
      toast.error(errorMessage(e));
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
      toast.success('Contacto agregado');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
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
      toast.error(errorMessage(e));
    }
  }

  async function removeContactPoint(point: ContactPoint) {
    const ok = await confirmar({
      title: `Quitar ${point.value}`,
      message: 'Se borra este dato de contacto de la ficha.',
      confirmLabel: 'Quitar',
    });
    if (!ok) return;
    try {
      await api(`/customers/${id}/contact-points/${point.id}`, { method: 'DELETE' });
      toast.success('Contacto quitado');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  function abrirFiscal(f: FiscalId | 'nueva') {
    setFiscalForm(
      f === 'nueva'
        ? { doc_type: 'ruc', doc_number: '', ruc_dv: '', legal_name: `${customer?.firstName ?? ''} ${customer?.lastName ?? ''}`.trim(), is_default: (customer?.fiscalIds.length ?? 0) === 0 }
        : { doc_type: f.docType, doc_number: f.docNumber, ruc_dv: f.rucDv ?? '', legal_name: f.legalName, is_default: f.isDefault },
    );
    setFiscal(f);
  }

  async function guardarFiscal(e: React.FormEvent) {
    e.preventDefault();
    if (!fiscal) return;
    setGuardandoFiscal(true);
    const json = {
      doc_type: fiscalForm.doc_type,
      doc_number: fiscalForm.doc_number.trim(),
      ...(fiscalForm.doc_type === 'ruc' && fiscalForm.ruc_dv ? { ruc_dv: fiscalForm.ruc_dv } : {}),
      legal_name: fiscalForm.legal_name.trim(),
      is_default: fiscalForm.is_default,
    };
    try {
      if (fiscal === 'nueva') await api(`/customers/${id}/fiscal-ids`, { method: 'POST', json });
      else await api(`/customers/${id}/fiscal-ids/${fiscal.id}`, { method: 'PATCH', json });
      toast.success(fiscal === 'nueva' ? 'Datos de facturación agregados' : 'Datos de facturación guardados');
      setFiscal(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardandoFiscal(false);
    }
  }

  async function predeterminarFiscal(f: FiscalId) {
    try {
      await api(`/customers/${id}/fiscal-ids/${f.id}`, { method: 'PATCH', json: { is_default: true } });
      toast.success(`Las facturas salen a nombre de ${f.legalName} salvo que elijas otro`);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function quitarFiscal(f: FiscalId) {
    const ok = await confirmar({
      title: `Quitar "${f.legalName}" de la ficha`,
      message: 'Las facturas ya emitidas a ese nombre no cambian. Podés volver a cargarlo cuando quieras.',
      confirmLabel: 'Quitar',
    });
    if (!ok) return;
    try {
      await api(`/customers/${id}/fiscal-ids/${f.id}`, { method: 'DELETE' });
      toast.success('Quitado de la ficha');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // ---------------- cuenta mensual ----------------
  async function guardarConsumo(e: React.FormEvent) {
    e.preventDefault();
    if (!consumo) return;
    setGuardandoExtra(true);
    try {
      await api(`/customers/${id}/charges`, {
        method: 'POST',
        json: consumo.service_id
          ? { service_id: consumo.service_id, quantity: Number(consumo.quantity) || 1, notes: consumo.notes.trim() || undefined }
          : {
              description: consumo.description.trim(),
              unit_price: consumo.unit_price.replace(/\./g, ''),
              quantity: Number(consumo.quantity) || 1,
              tax_rate: Number(consumo.tax_rate),
              notes: consumo.notes.trim() || undefined,
            },
      });
      toast.success('Consumo agregado a la cuenta del mes');
      setConsumo(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardandoExtra(false);
    }
  }

  async function anularConsumo(c: Consumo) {
    const ok = await confirmar({ title: `Anular "${c.description}"`, message: 'Se quita de la cuenta del mes. No se puede deshacer.', confirmLabel: 'Anular' });
    if (!ok) return;
    try {
      await api(`/billing/charges/${c.id}`, { method: 'DELETE' });
      toast.success('Consumo anulado');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  // ---------------- servicios recurrentes ----------------
  async function guardarRecurrente(e: React.FormEvent) {
    e.preventDefault();
    if (!recurrente || !branchId) return;
    if (recurrente.service_ids.length === 0) {
      toast.error('Elegí al menos un servicio.');
      return;
    }
    setGuardandoExtra(true);
    try {
      await api('/recurring-bookings', {
        method: 'POST',
        json: {
          customer_id: id,
          branch_id: branchId,
          service_ids: recurrente.service_ids,
          frequency: recurrente.frequency,
          ...(recurrente.frequency === 'monthly' ? { day_of_month: Number(recurrente.day_of_month) } : { weekday: Number(recurrente.weekday) }),
          time_local: recurrente.time_local,
          ...(recurrente.duration_min ? { duration_min: Number(recurrente.duration_min) } : {}),
          ...(recurrente.employee_id ? { employee_id: recurrente.employee_id } : {}),
          starts_on: recurrente.starts_on,
          ...(recurrente.ends_on ? { ends_on: recurrente.ends_on } : {}),
          ...(recurrente.notes.trim() ? { notes: recurrente.notes.trim() } : {}),
        },
      });
      toast.success('Servicio recurrente creado: el sistema va a agendar y pedir confirmación con anticipación');
      setRecurrente(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardandoExtra(false);
    }
  }

  async function toggleRecurrente(r: Recurrente) {
    try {
      await api(`/recurring-bookings/${r.id}`, { method: 'PATCH', json: { is_active: !r.isActive } });
      toast.success(r.isActive ? 'Recurrente pausado' : 'Recurrente reactivado');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function quitarRecurrente(r: Recurrente) {
    const ok = await confirmar({
      title: 'Quitar este servicio recurrente',
      message: 'No se generan más turnos. Los ya agendados quedan como están.',
      confirmLabel: 'Quitar',
    });
    if (!ok) return;
    try {
      await api(`/recurring-bookings/${r.id}`, { method: 'DELETE' });
      toast.success('Servicio recurrente quitado');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const describirRecurrente = (r: Recurrente) =>
    r.frequency === 'monthly'
      ? `${FRECUENCIA_LABEL[r.frequency]}, el día ${r.dayOfMonth} a las ${r.timeLocal}`
      : `${FRECUENCIA_LABEL[r.frequency] ?? r.frequency}, los ${DIAS_SEMANA[r.weekday ?? 0]?.toLowerCase()} a las ${r.timeLocal}`;

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
      toast.success('Agregado a la actividad del cliente');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
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
      toast.error(errorMessage(e));
    }
  }

  async function removeActivity(aId: string) {
    const ok = await confirmar({
      title: 'Borrar esta nota o tarea',
      message: 'Se quita de la actividad del cliente. No se puede deshacer.',
      confirmLabel: 'Borrar',
    });
    if (!ok) return;
    try {
      await api(`/customers/${id}/activities/${aId}`, { method: 'DELETE' });
      toast.success('Eliminada');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
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
      <div className="space-y-2">
        <Link className="text-sm text-sky-700 hover:underline" href="/app/customers">
          ← Clientes
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900">
            {customer.firstName} {customer.lastName}
          </h1>
          {/* Puntaje: clic en la estrella fija el valor; clic en la misma lo quita. Se guarda solo. */}
          <span className="text-lg" title="Puntaje del cliente (1 a 5)">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`Puntaje ${n} de 5`}
                className={n <= (form.rating ?? 0) ? 'text-amber-500' : 'text-slate-300 hover:text-amber-300'}
                onClick={() => void setRating(form.rating === n ? null : n)}
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
        {/* Acciones rapidas: lo que antes obligaba a salir a otra pantalla y buscar al cliente de nuevo */}
        <div className="flex flex-wrap gap-1.5">
          <Link className={buttonSoft} href={`/app/schedule?nuevo=1&customer=${customer.id}`}>
            Agendar turno
          </Link>
          <Link className={buttonGhost} href={`/app/inbox?customer=${customer.id}`}>
            Abrir chat
          </Link>
          <Link className={buttonGhost} href={`/app/invoices?nueva=1&customer=${customer.id}`}>
            Nueva factura
          </Link>
          <Link className={buttonGhost} href={`/app/invoices?vista=presupuestos&nuevo=1&customer=${customer.id}`}>
            Nuevo presupuesto
          </Link>
          {customer.phoneE164 && (
            <a className={buttonGhost} href={`https://wa.me/${customer.phoneE164.replace(/\D/g, '')}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
          )}
          <button className={buttonGhost} onClick={() => setFusionar(true)}>
            Unir con otra ficha…
          </button>
          <Button variant="danger" className="ml-auto" onClick={() => void desactivar()}>
            Desactivar
          </Button>
        </div>
      </div>
      <ErrorNote error={error} />

      {fusionar && (
        <Modal
          title="Unir fichas duplicadas"
          description={`Elegí el registro duplicado. Sus turnos, facturas, notas y contactos pasan a la ficha de ${customerName(customer)} y el duplicado se desactiva.`}
          onClose={() => setFusionar(false)}
        >
          <Field label="Ficha duplicada (la que se absorbe)">
            <CustomerPicker value={fusionCon} onChange={setFusionCon} allowCreate={false} autoFocus />
          </Field>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setFusionar(false)}>
              Volver
            </Button>
            <Button variant="primary" disabled={!fusionCon || fusionCon.id === customer.id} onClick={() => void confirmarFusion()}>
              Unir
            </Button>
          </div>
        </Modal>
      )}

      {fiscal && (
        <Modal
          title={fiscal === 'nueva' ? 'Agregar RUC o cédula para facturar' : `Editar "${fiscal.legalName}"`}
          description="RUC o cédula y a nombre de quién sale la factura (razón social o nombre completo)."
          onClose={() => setFiscal(null)}
          size="sm"
        >
          <form className="space-y-3" onSubmit={(e) => void guardarFiscal(e)}>
            <div className="grid grid-cols-[110px_1fr_70px] gap-2">
              <Field label="Documento">
                <select
                  className={inputClass}
                  value={fiscalForm.doc_type}
                  onChange={(e) => {
                    const doc_type = e.target.value;
                    setFiscalForm({ ...fiscalForm, doc_type, ruc_dv: doc_type === 'ruc' ? (dvRuc(fiscalForm.doc_number) ?? '') : '' });
                  }}
                >
                  <option value="ruc">RUC</option>
                  <option value="ci">Cédula</option>
                  <option value="pasaporte">Pasaporte</option>
                </select>
              </Field>
              <Field label="Número *">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  autoFocus
                  required
                  placeholder={fiscalForm.doc_type === 'ruc' ? '80012345 (sin el DV)' : '1234567'}
                  value={fiscalForm.doc_number}
                  onChange={(e) => {
                    const doc_number = e.target.value;
                    setFiscalForm({ ...fiscalForm, doc_number, ruc_dv: fiscalForm.doc_type === 'ruc' ? (dvRuc(doc_number) ?? '') : '' });
                  }}
                />
              </Field>
              {fiscalForm.doc_type === 'ruc' ? (
                <Field label="DV">
                  <input className={`${inputClass} bg-slate-100`} readOnly value={fiscalForm.ruc_dv} title="Se calcula solo" />
                </Field>
              ) : (
                <span />
              )}
            </div>
            <Field label="Razón social o nombre completo *">
              <input className={inputClass} required value={fiscalForm.legal_name} onChange={(e) => setFiscalForm({ ...fiscalForm, legal_name: e.target.value })} placeholder="Ej: Estudio Creativo S.A." />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={fiscalForm.is_default} onChange={(e) => setFiscalForm({ ...fiscalForm, is_default: e.target.checked })} />
              Usar por defecto en las facturas nuevas
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setFiscal(null)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardandoFiscal}>
                {fiscal === 'nueva' ? 'Agregar' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {consumo && (
        <Modal title="Agregar consumo a la cuenta del mes" description="Un producto del catálogo o algo libre (descripción y precio). Se factura junto con el resto al cierre." onClose={() => setConsumo(null)} size="sm">
          <form className="space-y-3" onSubmit={(e) => void guardarConsumo(e)}>
            <Field label="Del catálogo (o dejá vacío para cargar algo libre)">
              <select className={inputClass} value={consumo.service_id} onChange={(e) => setConsumo({ ...consumo, service_id: e.target.value })}>
                <option value="">— consumo libre —</option>
                {servicios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            {!consumo.service_id && (
              <div className="grid grid-cols-[1fr_110px_90px] gap-2">
                <Field label="Descripción *">
                  <input className={inputClass} required value={consumo.description} onChange={(e) => setConsumo({ ...consumo, description: e.target.value })} placeholder="Ej: Shampoo 500 ml" />
                </Field>
                <Field label="Precio (Gs) *">
                  <MoneyInput required value={consumo.unit_price} onChange={(unit_price) => setConsumo({ ...consumo, unit_price })} />
                </Field>
                <Field label="IVA">
                  <select className={inputClass} value={consumo.tax_rate} onChange={(e) => setConsumo({ ...consumo, tax_rate: e.target.value })}>
                    <option value="10">10%</option>
                    <option value="5">5%</option>
                    <option value="0">Exento</option>
                  </select>
                </Field>
              </div>
            )}
            <div className="grid grid-cols-[90px_1fr] gap-2">
              <Field label="Cantidad">
                <input className={inputClass} type="number" min="0.5" step="0.5" value={consumo.quantity} onChange={(e) => setConsumo({ ...consumo, quantity: e.target.value })} />
              </Field>
              <Field label="Nota (opcional)">
                <input className={inputClass} value={consumo.notes} onChange={(e) => setConsumo({ ...consumo, notes: e.target.value })} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConsumo(null)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardandoExtra}>
                Agregar
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {recurrente && (
        <Modal
          title="Nuevo servicio recurrente"
          description={`El sistema va a agendar el turno con anticipación (Ajustes → Horarios) y a pedirle a ${customer.firstName} que confirme por WhatsApp.`}
          onClose={() => setRecurrente(null)}
          size="lg"
        >
          <form className="space-y-3" onSubmit={(e) => void guardarRecurrente(e)}>
            <Field label="Servicios *">
              <div className="max-h-36 space-y-0.5 overflow-y-auto rounded-md border border-slate-300 p-1.5">
                {servicios
                  .filter((s) => s.kind === 'servicio')
                  .map((s) => (
                    <label key={s.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={recurrente.service_ids.includes(s.id)}
                        onChange={(e) =>
                          setRecurrente({ ...recurrente, service_ids: e.target.checked ? [...recurrente.service_ids, s.id] : recurrente.service_ids.filter((x) => x !== s.id) })
                        }
                      />
                      <span className="flex-1">{s.name}</span>
                      <span className="text-xs text-slate-400">{s.durationMin ?? 30} min</span>
                    </label>
                  ))}
              </div>
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Frecuencia">
                <select className={inputClass} value={recurrente.frequency} onChange={(e) => setRecurrente({ ...recurrente, frequency: e.target.value })}>
                  <option value="weekly">Cada semana</option>
                  <option value="biweekly">Cada dos semanas</option>
                  <option value="monthly">Cada mes</option>
                </select>
              </Field>
              {recurrente.frequency === 'monthly' ? (
                <Field label="Día del mes (1 a 28)">
                  <input className={inputClass} type="number" min={1} max={28} value={recurrente.day_of_month} onChange={(e) => setRecurrente({ ...recurrente, day_of_month: e.target.value })} />
                </Field>
              ) : (
                <Field label="Día de la semana">
                  <select className={inputClass} value={recurrente.weekday} onChange={(e) => setRecurrente({ ...recurrente, weekday: e.target.value })}>
                    {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                      <option key={d} value={d}>
                        {DIAS_SEMANA[d]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Hora">
                <input className={inputClass} type="time" value={recurrente.time_local} onChange={(e) => setRecurrente({ ...recurrente, time_local: e.target.value })} required />
              </Field>
              <Field label="Duración (min; vacío = la de los servicios)">
                <input className={inputClass} type="number" min={5} max={720} step={5} value={recurrente.duration_min} onChange={(e) => setRecurrente({ ...recurrente, duration_min: e.target.value })} />
              </Field>
              {empleados.length > 0 && (
                <Field label="Atiende">
                  <select className={inputClass} value={recurrente.employee_id} onChange={(e) => setRecurrente({ ...recurrente, employee_id: e.target.value })}>
                    <option value="">Cualquiera</option>
                    {empleados.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.firstName} {e.lastName}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Desde">
                <input className={inputClass} type="date" value={recurrente.starts_on} onChange={(e) => setRecurrente({ ...recurrente, starts_on: e.target.value })} required />
              </Field>
              <Field label="Hasta (opcional)">
                <input className={inputClass} type="date" value={recurrente.ends_on} onChange={(e) => setRecurrente({ ...recurrente, ends_on: e.target.value })} />
              </Field>
            </div>
            <Field label="Nota para el equipo (opcional)">
              <input className={inputClass} value={recurrente.notes} onChange={(e) => setRecurrente({ ...recurrente, notes: e.target.value })} />
            </Field>
            {!customer.phoneE164 && <p className="text-xs text-amber-700">Este cliente no tiene celular: los turnos se van a crear, pero no se le puede pedir confirmación por WhatsApp.</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setRecurrente(null)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardandoExtra} disabled={recurrente.service_ids.length === 0 || !branchId}>
                Crear recurrente
              </Button>
            </div>
          </form>
        </Modal>
      )}

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
                  <option value="ci">Cédula (CI)</option>
                  <option value="ruc">RUC</option>
                  <option value="pasaporte">Pasaporte</option>
                </select>
              </Field>
              <Field label="Número de documento">
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
                <Field label="DV (automático)">
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
                <Field label="Dirección">
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
              <Field label="Origen (de dónde llegó)">
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
                <input className={inputClass} placeholder="Ej: campaña agosto, cliente María" value={form.source_detail} onChange={(e) => setForm({ ...form, source_detail: e.target.value })} />
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

              <GroupTitle>Facturación y avisos</GroupTitle>
              <Field label="Cómo se le factura">
                <select className={inputClass} value={form.billing_mode} onChange={(e) => setForm({ ...form, billing_mode: e.target.value })}>
                  <option value="per_service">Por servicio (cada vez que se atiende)</option>
                  <option value="monthly">Cuenta mensual (acumula y se factura al cierre)</option>
                </select>
              </Field>
              <Field label="Recibe las facturas y resúmenes por">
                <select className={inputClass} value={form.invoice_channel} onChange={(e) => setForm({ ...form, invoice_channel: e.target.value })}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">Email</option>
                </select>
              </Field>
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
              </div>
              {/* Barra de guardado siempre visible mientras haya cambios (antes el boton quedaba al fondo de 20 campos) */}
              <div
                className={`sticky bottom-0 z-10 col-span-2 -mx-4 -mb-4 mt-2 flex flex-wrap items-center justify-between gap-2 rounded-b-xl border-t px-4 py-3 md:col-span-4 ${
                  dirty ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-white'
                }`}
              >
                <span className={`text-sm ${dirty ? 'font-medium text-amber-800' : 'text-slate-400'}`}>
                  {dirty ? 'Tenés cambios sin guardar' : 'Sin cambios pendientes'}
                </span>
                <span className="flex gap-2">
                  {dirty && (
                    <Button variant="ghost" onClick={() => setForm(toForm(customer))}>
                      Descartar
                    </Button>
                  )}
                  <Button variant="primary" type="submit" loading={guardando} disabled={!dirty}>
                    Guardar cambios
                  </Button>
                </span>
              </div>
            </form>
          </Card>

          <Card
            title="Otros contactos"
            description="Teléfonos, emails o redes adicionales al celular y email principales de arriba."
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
                  <button type="button" className="ml-auto text-xs text-red-600 hover:underline" onClick={() => void removeContactPoint(point)}>
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
              <Button variant="soft" type="submit">
                Agregar contacto
              </Button>
            </form>
          </Card>

          <Card
            title="Datos de facturación (RUC / razón social)"
            description="A nombre de quién le facturás. Puede tener varios (su empresa, otra persona) y elegir uno distinto en cada factura. El documento de arriba es el personal; estos son los fiscales."
            actions={
              <Button variant="soft" onClick={() => abrirFiscal('nueva')}>
                Agregar RUC o cédula
              </Button>
            }
          >
            <ul className="divide-y divide-slate-100">
              {(customer.fiscalIds ?? []).map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <span className="font-medium text-slate-800">{f.legalName}</span>
                  <span className="text-xs text-slate-500">
                    {f.docType === 'ruc' ? 'RUC' : f.docType === 'ci' ? 'CI' : 'Pasaporte'} {f.docNumber}
                    {f.rucDv ? `-${f.rucDv}` : ''}
                  </span>
                  {f.isDefault ? (
                    <Badge tone="emerald">predeterminado</Badge>
                  ) : (
                    <button type="button" className="text-xs text-sky-700 hover:underline" onClick={() => void predeterminarFiscal(f)}>
                      Usar por defecto
                    </button>
                  )}
                  <span className="ml-auto inline-flex gap-1">
                    <button type="button" className={buttonGhost} onClick={() => abrirFiscal(f)}>
                      Editar
                    </button>
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => void quitarFiscal(f)}>
                      Quitar
                    </button>
                  </span>
                </li>
              ))}
              {(customer.fiscalIds ?? []).length === 0 && (
                <li className="py-2 text-sm text-slate-400">
                  Sin datos de facturación guardados.{' '}
                  {customer.docNumber ? 'Mientras no cargues ninguno, las facturas salen con su documento personal.' : 'Al crear una factura se van a pedir.'}
                </li>
              )}
            </ul>
          </Card>

          {(customer.billingMode === 'monthly' || consumos.length > 0) && (
            <Card
              title={`Cuenta del mes${consumos.length ? ` · ${money(consumos.reduce((a, c) => a + Number(c.lineTotal), 0))} pendientes` : ''}`}
              description="Lo atendido entra solo al marcar el turno como Atendido. Las compras y extras se cargan acá. Se factura todo junto desde Facturación → Cuentas del mes o en el cierre automático."
              actions={
                <Button variant="soft" onClick={() => setConsumo(CONSUMO_VACIO)}>
                  Agregar consumo
                </Button>
              }
            >
              <ul className="divide-y divide-slate-100 text-sm">
                {consumos.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <span className="w-20 text-xs text-slate-400">{new Date(c.chargedOn).toLocaleDateString(undefined, { timeZone: 'UTC' })}</span>
                    <span className="flex-1">
                      {c.description}
                      {Number(c.quantity) !== 1 && <span className="text-xs text-slate-400"> x{Number(c.quantity)}</span>}
                      <span className="ml-1 text-xs text-slate-400">{c.source === 'appointment' ? '· turno' : '· a mano'}</span>
                    </span>
                    <span className="tabular-nums">{money(c.lineTotal)}</span>
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => void anularConsumo(c)}>
                      Anular
                    </button>
                  </li>
                ))}
                {consumos.length === 0 && <li className="py-1.5 text-slate-400">Sin consumos pendientes este mes.</li>}
              </ul>
            </Card>
          )}

          <Card
            title="Servicios recurrentes"
            description="Lo que toma siempre igual (cada semana, cada dos semanas o cada mes). El sistema agenda el turno con anticipación y le pide por WhatsApp que confirme con SÍ o NO."
            actions={
              <Button variant="soft" onClick={() => setRecurrente({ ...RECURRENTE_VACIO, starts_on: new Date().toISOString().slice(0, 10) })}>
                Nuevo recurrente
              </Button>
            }
          >
            <ul className="divide-y divide-slate-100 text-sm">
              {recurrentes.map((r) => (
                <li key={r.id} className={`flex flex-wrap items-center gap-2 py-2 ${r.isActive ? '' : 'opacity-60'}`}>
                  <span className="flex-1">
                    <span className="font-medium text-slate-800">{r.services.map((x) => x.name).join(' + ')}</span>
                    <span className="block text-xs text-slate-500">
                      {describirRecurrente(r)} · {r.durationMin} min{r.employee ? ` · con ${r.employee.firstName} ${r.employee.lastName}` : ''}
                      {r.endsOn ? ` · hasta ${new Date(r.endsOn).toLocaleDateString(undefined, { timeZone: 'UTC' })}` : ''}
                    </span>
                    {r.lastError && <span className="block text-xs text-amber-700">Último intento: {r.lastError}</span>}
                  </span>
                  {!r.isActive && <Badge tone="slate">pausado</Badge>}
                  <button type="button" className={buttonGhost} onClick={() => void toggleRecurrente(r)}>
                    {r.isActive ? 'Pausar' : 'Reactivar'}
                  </button>
                  <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => void quitarRecurrente(r)}>
                    Quitar
                  </button>
                </li>
              ))}
              {recurrentes.length === 0 && <li className="py-1.5 text-slate-400">Sin servicios recurrentes.</li>}
            </ul>
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
                      <td>
                        {h.visit_status ? (
                          <Badge tone={statusOf(APPOINTMENT_STATUS, h.visit_status).tone}>
                            {statusOf(APPOINTMENT_STATUS, h.visit_status).label}
                          </Badge>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>
                        {h.invoice_id ? (
                          <Link className="text-sky-700 hover:underline" href={`/app/invoices?factura=${h.invoice_id}`}>
                            {money(h.total ?? 0)}{' '}
                            <span className="text-xs text-slate-500">({statusOf(INVOICE_STATUS, h.invoice_status).label})</span>
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 text-center text-slate-400">
                        Sin visitas ni facturas todavía
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
                Resumen de la última conversación
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
                  <option value="">Responsable: nadie en particular</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </select>
              )}
              <div className="flex gap-2">
                <input className={inputClass} placeholder="Escribí la nota o tarea…" value={act.body} onChange={(e) => setAct({ ...act, body: e.target.value })} required />
                <Button variant="soft" type="submit">
                  Agregar
                </Button>
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
              {activities.length === 0 && <li className="text-sm text-slate-400">Sin notas todavía</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
