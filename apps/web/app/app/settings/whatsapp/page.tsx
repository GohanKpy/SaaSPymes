'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import { api } from '../../../../lib/api';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { Badge, Button, Card, ErrorNote, Field, buttonGhost, inputClass } from '../../../../lib/ui';

// Conexion de WhatsApp (fase 2 auditoria de paneles 2026-09-05): el
// formulario muestra lo ya guardado (antes aparecia vacio y habia que
// retipear el token), los campos hablan en español con ayuda de donde
// obtenerlos, y hay un semaforo de tres estados.

interface Integration {
  type: string;
  configured: boolean;
  public_config: Record<string, unknown>;
}

export default function WhatsappPage() {
  const toast = useToast();
  const [wa, setWa] = useState<Integration | null | undefined>(undefined);
  const [form, setForm] = useState({ phone_number_id: '', access_token: '', verify_token: '', live: false });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Integration[]>('/integrations')
      .then((rows) => {
        const w = rows.find((i) => i.type === 'whatsapp') ?? null;
        setWa(w);
        setForm({
          phone_number_id: typeof w?.public_config.phone_number_id === 'string' ? w.public_config.phone_number_id : '',
          access_token: '',
          verify_token: '',
          live: w?.public_config.live === true,
        });
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar la conexión de WhatsApp.')));
  }, []);
  useEffect(() => load(), [load]);

  const configurado = Boolean(wa?.configured);
  const live = wa?.public_config.live === true;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      await api('/integrations/whatsapp', {
        method: 'PUT',
        json: {
          phone_number_id: form.phone_number_id.trim(),
          ...(form.access_token.trim() ? { access_token: form.access_token.trim() } : {}),
          ...(form.verify_token.trim() ? { verify_token: form.verify_token.trim() } : {}),
          live: form.live,
        },
      });
      toast.success('Conexión de WhatsApp guardada');
      load();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  if (wa === undefined) return <ErrorNote error={error} />;

  return (
    <>
      <ErrorNote error={error} />
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            Conexión de WhatsApp
            {!configurado ? (
              <Badge tone="slate">sin configurar</Badge>
            ) : live ? (
              <Badge tone="emerald">conectado: envío real</Badge>
            ) : (
              <Badge tone="amber">modo de prueba</Badge>
            )}
          </span>
        }
        description={
          !configurado
            ? 'Para empezar a probar el bot alcanza con un identificador cualquiera (ej. mi-negocio-prueba). Cuando tengas tu cuenta de WhatsApp Business aprobada por Meta, cargás los datos reales y activás el envío real.'
            : live
              ? 'Los mensajes del bot salen de verdad por tu número de WhatsApp.'
              : 'Estás en modo de prueba: podés hablar con el bot desde el chat de prueba, pero todavía no envía mensajes reales.'
        }
      >
        <form className="space-y-3" onSubmit={(e) => void save(e)}>
          <Field label="Identificador del número de WhatsApp *">
            <input
              className={inputClass}
              value={form.phone_number_id}
              onChange={(e) => setForm({ ...form, phone_number_id: e.target.value })}
              placeholder="En pruebas: cualquier nombre, ej. mi-negocio. Real: el «phone number ID» de Meta."
              required
            />
          </Field>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label={configurado ? 'Token de acceso (cargado ✓ — dejalo vacío para mantenerlo)' : 'Token de acceso *'}>
              <input
                className={inputClass}
                type="password"
                autoComplete="off"
                value={form.access_token}
                onChange={(e) => setForm({ ...form, access_token: e.target.value })}
                placeholder={configurado ? '••••••••' : 'En pruebas: cualquier texto'}
                required={!configurado}
              />
            </Field>
            <Field label={configurado ? 'Token de verificación (cargado ✓ — dejalo vacío para mantenerlo)' : 'Token de verificación *'}>
              <input
                className={inputClass}
                autoComplete="off"
                value={form.verify_token}
                onChange={(e) => setForm({ ...form, verify_token: e.target.value })}
                placeholder={configurado ? '••••••••' : 'Una palabra clave que vos elegís'}
                required={!configurado}
              />
            </Field>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5" checked={form.live} onChange={(e) => setForm({ ...form, live: e.target.checked })} />
            <span>
              <b>Envío real por WhatsApp</b>
              <span className="block text-xs text-slate-500">
                Solo con la cuenta de WhatsApp Business de Meta aprobada y el token real. Con esto apagado, el bot funciona igual en el chat de prueba.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Link className={buttonGhost} href="/app/inbox">
              Probar el bot en el chat
            </Link>
            <Button variant="primary" type="submit" loading={guardando}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>

      <Card title="¿De dónde saco estos datos?" description="Solo hace falta cuando pasás a envío real.">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>Entrá a Meta for Developers con la cuenta de tu empresa y abrí tu app de WhatsApp Business.</li>
          <li>
            En <b>WhatsApp → Configuración de la API</b> vas a ver el <b>identificador del número</b> (phone number ID) y podés generar el{' '}
            <b>token de acceso</b> permanente.
          </li>
          <li>
            El <b>token de verificación</b> lo inventás vos: es la palabra clave que Meta te pide al configurar el webhook. Usá la misma acá y allá.
          </li>
          <li>Si algo no cierra, pedile ayuda a quien te instaló el sistema: es un trámite de una sola vez.</li>
        </ol>
      </Card>
    </>
  );
}
