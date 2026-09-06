'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../lib/api';
import { useToast } from '../../../lib/feedback';
import { errorMessage } from '../../../lib/labels';
import { Button, EmptyState, ErrorNote, Field, Modal, PageHeader, buttonGhost, inputClass, money } from '../../../lib/ui';

// Planes (fase 3 auditoria de paneles 2026-09-05): alta y edicion en ventana.
// Planes y funciones son datos, no codigo (CLAUDE.md): lo que incluye cada
// plan se define aca; los acuerdos a medida, en la ficha de cada cliente.

interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyPrice: string;
  maxUsers: number;
  maxBranches: number;
  isActive: boolean;
  planFeatures: { feature: { code: string; name: string } }[];
}
interface Feature {
  id: string;
  code: string;
  name: string;
}
interface PlanForm {
  code: string;
  name: string;
  monthly_price: string;
  max_users: number;
  max_branches: number;
  feature_codes: string[];
}

const PLAN_VACIO: PlanForm = { code: '', name: '', monthly_price: '0', max_users: 3, max_branches: 1, feature_codes: [] };

export default function PlanesPage() {
  const toast = useToast();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Plan | 'nuevo' | null>(null);
  const [form, setForm] = useState<PlanForm>(PLAN_VACIO);
  const [guardando, setGuardando] = useState(false);

  const load = useCallback(() => {
    api<Plan[]>('/platform/plans')
      .then((p) => {
        setPlans(p);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e, 'No se pudieron cargar los planes.')));
    void api<Feature[]>('/platform/features').then(setFeatures).catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  function abrirNuevo() {
    setForm(PLAN_VACIO);
    setModal('nuevo');
  }
  function abrirEditar(p: Plan) {
    setForm({
      code: p.code,
      name: p.name,
      monthly_price: p.monthlyPrice,
      max_users: p.maxUsers,
      max_branches: p.maxBranches,
      feature_codes: p.planFeatures.map((pf) => pf.feature.code),
    });
    setModal(p);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setGuardando(true);
    const body = { ...form, monthly_price: form.monthly_price || '0' };
    try {
      if (modal === 'nuevo') {
        await api('/platform/plans', { method: 'POST', json: body });
        toast.success(`Plan "${form.name}" creado`);
      } else {
        const { code: _code, ...rest } = body;
        await api(`/platform/plans/${modal.id}`, { method: 'PATCH', json: rest });
        toast.success(`Plan "${form.name}" guardado`);
      }
      setModal(null);
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Planes"
        description="Qué incluye cada plan y cuánto cuesta. Un cliente ve en su panel solo las funciones de su plan; lo que se le da suelto por acuerdo se gestiona en su ficha."
        actions={
          <Button variant="primary" onClick={abrirNuevo}>
            Nuevo plan
          </Button>
        }
      />
      <ErrorNote error={error} />

      {plans && plans.length === 0 && (
        <EmptyState
          title="Todavía no hay planes"
          description="Sin planes no se puede dar de alta un cliente."
          action={
            <Button variant="primary" onClick={abrirNuevo}>
              Crear el primero
            </Button>
          }
        />
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {(plans ?? []).map((p) => (
          <div key={p.id} className={`rounded-xl border bg-white p-4 text-sm shadow-sm ${p.isActive ? 'border-slate-200' : 'border-dashed border-slate-300 text-slate-400'}`}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-slate-900">{p.name}</p>
                <p className="text-xs text-slate-400">código {p.code}</p>
              </div>
              <button className={buttonGhost} onClick={() => abrirEditar(p)}>
                Editar
              </button>
            </div>
            <p className="mt-2 text-lg font-semibold text-slate-800">
              {money(p.monthlyPrice)}
              <span className="text-xs font-normal text-slate-500"> / mes</span>
            </p>
            <p className="text-xs text-slate-500">
              hasta {p.maxUsers} usuario{p.maxUsers === 1 ? '' : 's'} · {p.maxBranches} sucursal{p.maxBranches === 1 ? '' : 'es'}
            </p>
            <ul className="mt-3 space-y-0.5 text-xs text-slate-600">
              {p.planFeatures.map((pf) => (
                <li key={pf.feature.code}>✓ {pf.feature.name}</li>
              ))}
              {p.planFeatures.length === 0 && <li className="text-slate-400">Sin funciones incluidas.</li>}
            </ul>
          </div>
        ))}
      </div>

      {modal && (
        <Modal title={modal === 'nuevo' ? 'Nuevo plan' : `Editar plan "${modal.name}"`} onClose={() => setModal(null)} size="lg">
          <form className="space-y-3" onSubmit={(e) => void guardar(e)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre *">
                <input className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
              </Field>
              <Field label={modal === 'nuevo' ? 'Código * (minúsculas, sin espacios; no se cambia después)' : 'Código'}>
                <input
                  className={inputClass}
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  disabled={modal !== 'nuevo'}
                  pattern="[a-z0-9_-]+"
                  placeholder="ej: basico"
                  required
                />
              </Field>
              <Field label="Precio mensual (Gs)">
                <input className={inputClass} type="number" min={0} step={1000} value={form.monthly_price} onChange={(e) => setForm({ ...form, monthly_price: e.target.value })} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Máx. usuarios">
                  <input className={inputClass} type="number" min={1} value={form.max_users} onChange={(e) => setForm({ ...form, max_users: Number(e.target.value) })} />
                </Field>
                <Field label="Máx. sucursales">
                  <input className={inputClass} type="number" min={1} value={form.max_branches} onChange={(e) => setForm({ ...form, max_branches: Number(e.target.value) })} />
                </Field>
              </div>
            </div>
            <Field label="Funciones incluidas">
              <div className="grid gap-1.5 sm:grid-cols-2">
                {features.map((f) => (
                  <label key={f.code} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.feature_codes.includes(f.code)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          feature_codes: e.target.checked ? [...form.feature_codes, f.code] : form.feature_codes.filter((c) => c !== f.code),
                        })
                      }
                    />
                    {f.name}
                  </label>
                ))}
              </div>
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setModal(null)}>
                Volver
              </Button>
              <Button variant="primary" type="submit" loading={guardando}>
                {modal === 'nuevo' ? 'Crear plan' : 'Guardar'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
