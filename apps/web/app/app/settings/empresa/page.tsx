'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../../lib/api';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { formatRucConDv } from '../../../../lib/ruc';
import { RucEstado, useRucAutofill } from '../../../../lib/ruc-lookup';
import { Button, Card, ErrorNote, Field, inputClass } from '../../../../lib/ui';

interface TenantMe {
  legalName: string;
  tradeName: string | null;
  ruc: string | null;
  branding: Record<string, unknown>;
  currentPlan: { name: string } | null;
}
interface EffectiveFeature {
  code: string;
  name: string;
  enabled: boolean;
  source: string;
}

/** Datos de la empresa y marca: lo que se imprime en el comprobante y lo que el bot responde. */
export default function EmpresaPage() {
  const toast = useToast();
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [branding, setBranding] = useState<Record<string, unknown>>({});
  const [marca, setMarca] = useState({ logo: '', actividad: '', email_facturacion: '' });
  const [empresa, setEmpresa] = useState({ legal_name: '', trade_name: '', ruc: '' });
  const [plan, setPlan] = useState<string | null>(null);
  const [features, setFeatures] = useState<EffectiveFeature[]>([]);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [sucursal, setSucursal] = useState({ address: '', phone: '' });
  // Padron RUC (ADR 0012): valida el RUC del negocio contra la DNIT y ofrece la razon social oficial.
  const padron = useRucAutofill({
    ruc: empresa.ruc,
    enabled: true,
    legalName: empresa.legal_name,
    onFill: (p) => setEmpresa((e) => ({ ...e, legal_name: p.legal_name })),
  });

  const load = useCallback(() => {
    api<TenantMe>('/tenant')
      .then((t) => {
        setBranding(t.branding ?? {});
        setPlan(t.currentPlan?.name ?? null);
        setEmpresa({ legal_name: t.legalName, trade_name: t.tradeName ?? '', ruc: t.ruc ?? '' });
        setMarca({
          logo: typeof t.branding?.logo === 'string' ? t.branding.logo : '',
          actividad: typeof t.branding?.actividad === 'string' ? t.branding.actividad : '',
          email_facturacion: typeof t.branding?.email_facturacion === 'string' ? t.branding.email_facturacion : '',
        });
      })
      .catch((e) => setError(errorMessage(e, 'No se pudieron cargar los datos de la empresa.')));
    void api<EffectiveFeature[]>('/tenant/features').then(setFeatures).catch(() => undefined);
    void api<{ id: string; isMain: boolean; address: string | null; phone: string | null }[]>('/branches')
      .then((rows) => {
        const main = rows.find((b) => b.isMain) ?? rows[0];
        if (main) {
          setBranchId(main.id);
          setSucursal({ address: main.address ?? '', phone: main.phone ?? '' });
        }
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => load(), [load]);

  function onLogoFile(file: File | undefined) {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast.error('El logo tiene que ser PNG o JPEG.');
      return;
    }
    if (file.size > 350_000) {
      toast.error('El logo no puede pesar más de 350 KB: achicalo y volvé a subirlo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setMarca((m) => ({ ...m, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api('/tenant', {
        method: 'PATCH',
        json: {
          legal_name: empresa.legal_name,
          trade_name: empresa.trade_name || null,
          ruc: empresa.ruc || null,
          branding: {
            ...branding,
            logo: marca.logo || undefined,
            actividad: marca.actividad || undefined,
            email_facturacion: marca.email_facturacion || undefined,
          },
        },
      });
      if (branchId) {
        await api(`/branches/${branchId}`, {
          method: 'PATCH',
          json: { address: sucursal.address || undefined, phone: sucursal.phone || undefined },
        });
      }
      toast.success('Datos de la empresa guardados');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <>
      <ErrorNote error={error} />
      <Card
        title="Datos de la empresa y marca"
        description="Salen en el encabezado del comprobante de tus facturas y el bot los usa para responder dirección y teléfono."
      >
        <form className="grid grid-cols-1 items-start gap-4 md:grid-cols-3" onSubmit={(e) => void save(e)}>
          <Field label="Razón social *">
            <input className={inputClass} value={empresa.legal_name} onChange={(e) => setEmpresa({ ...empresa, legal_name: e.target.value })} required />
          </Field>
          <Field label="Nombre de fantasía">
            <input className={inputClass} value={empresa.trade_name} onChange={(e) => setEmpresa({ ...empresa, trade_name: e.target.value })} />
          </Field>
          <Field label="RUC (el dígito verificador se completa solo)">
            <input
              className={inputClass}
              placeholder="80012345"
              value={empresa.ruc}
              onChange={(e) => setEmpresa({ ...empresa, ruc: e.target.value })}
              onBlur={(e) => setEmpresa({ ...empresa, ruc: formatRucConDv(e.target.value) })}
            />
            {(padron.loading || padron.lookup) && (
              <div className="mt-1">
                <RucEstado lookup={padron.lookup} loading={padron.loading} sugerencia={padron.sugerencia} onUsar={padron.usarSugerencia} />
              </div>
            )}
          </Field>
          <Field label="Actividad económica">
            <input className={inputClass} placeholder="Ej: Peluquería y estética" value={marca.actividad} onChange={(e) => setMarca({ ...marca, actividad: e.target.value })} />
          </Field>
          <Field label="Dirección (la responde el bot y sale en el comprobante)">
            <input className={inputClass} placeholder="Avda. …, Asunción" value={sucursal.address} onChange={(e) => setSucursal({ ...sucursal, address: e.target.value })} />
          </Field>
          <Field label="Teléfono del negocio">
            <input className={inputClass} placeholder="(0981) 123-456" value={sucursal.phone} onChange={(e) => setSucursal({ ...sucursal, phone: e.target.value })} />
          </Field>
          <Field label="Email de facturación">
            <input className={inputClass} type="email" value={marca.email_facturacion} onChange={(e) => setMarca({ ...marca, email_facturacion: e.target.value })} />
          </Field>
          <div className="space-y-2 md:col-span-2">
            <Field label="Logo (PNG o JPEG, hasta 350 KB)">
              <input className="block w-full text-sm" type="file" accept="image/png,image/jpeg" onChange={(e) => onLogoFile(e.target.files?.[0])} />
            </Field>
            {marca.logo && (
              <div className="flex items-center gap-3">
                {/* data URL local: <img> directo, next/image no aplica */}
                <img src={marca.logo} alt="logo" className="h-16 w-16 rounded border border-slate-200 object-contain" />
                <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => setMarca({ ...marca, logo: '' })}>
                  Quitar logo
                </button>
              </div>
            )}
          </div>
          <div className="flex justify-end md:col-span-3">
            <Button variant="primary" type="submit" loading={guardando}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>

      {features.length > 0 && (
        <Card
          title={plan ? `Tu plan: ${plan}` : 'Tu plan'}
          description="Lo que tu plan incluye hoy. Para sumar una función, hablá con quien te vendió el sistema."
        >
          <div className="flex flex-wrap gap-2">
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
        </Card>
      )}
    </>
  );
}
