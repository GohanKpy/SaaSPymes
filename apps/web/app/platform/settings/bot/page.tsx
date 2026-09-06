'use client';

import { useEffect, useState } from 'react';

import { api } from '../../../../lib/api';
import { useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { Badge, Button, Card, ErrorNote, Field, PageHeader, inputClass } from '../../../../lib/ui';

// Motor del bot (fase 3 auditoria de paneles 2026-09-05). Proveedor, modelo y
// llaves se gestionan aca (ADR 0003): rotar una llave o cambiar de proveedor
// rige en menos de 30 segundos, sin deploy. Nada de esto va fijo en codigo.

interface BotEngine {
  provider: 'openai' | 'anthropic';
  model: string | null;
  base_prompt: string | null;
  reply_debounce_seconds: number;
  hourly_budget_divisor: number;
  fallback_notice: string | null;
  budget_notice: string | null;
  keys: { openai: boolean; anthropic: boolean };
  source: 'panel' | 'env';
}

const PROVEEDOR: Record<BotEngine['provider'], string> = { openai: 'OpenAI', anthropic: 'Anthropic' };

export default function MotorBotPage() {
  const toast = useToast();
  const [engine, setEngine] = useState<BotEngine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ provider: 'openai' as BotEngine['provider'], model: '', openai_api_key: '', anthropic_api_key: '' });
  const [ops, setOps] = useState({ debounce: 15, divisor: 30, fallback: '', budget: '' });
  const [basePrompt, setBasePrompt] = useState('');
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api<BotEngine>('/platform/settings/bot')
      .then((e) => {
        setEngine(e);
        setForm((f) => ({ ...f, provider: e.provider, model: e.model ?? '' }));
        setBasePrompt(e.base_prompt ?? '');
        setOps({
          debounce: e.reply_debounce_seconds,
          divisor: e.hourly_budget_divisor,
          fallback: e.fallback_notice ?? '',
          budget: e.budget_notice ?? '',
        });
      })
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar la configuración del motor.')));
  }, []);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    try {
      const updated = await api<BotEngine>('/platform/settings/bot', {
        method: 'PUT',
        json: {
          provider: form.provider,
          model: form.model.trim() || null,
          base_prompt: basePrompt.trim() || null,
          reply_debounce_seconds: ops.debounce,
          hourly_budget_divisor: ops.divisor,
          fallback_notice: ops.fallback.trim() || null,
          budget_notice: ops.budget.trim() || null,
          ...(form.openai_api_key ? { openai_api_key: form.openai_api_key } : {}),
          ...(form.anthropic_api_key ? { anthropic_api_key: form.anthropic_api_key } : {}),
        },
      });
      setEngine(updated);
      setForm((f) => ({ ...f, openai_api_key: '', anthropic_api_key: '' }));
      toast.success('Motor actualizado: rige en menos de 30 segundos para todos los clientes');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setGuardando(false);
    }
  }

  const llaveActiva = engine ? engine.keys[engine.provider] : false;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Motor del bot (IA)"
        description="El cerebro del bot de TODOS los clientes: proveedor, modelo, llaves, tiempos y la guía de atención estándar. Los cambios rigen en menos de 30 segundos, sin reiniciar nada."
      />
      <ErrorNote error={error} />

      {engine && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">Ahora mismo:</span>
          <Badge tone="violet">{PROVEEDOR[engine.provider]}</Badge>
          <Badge tone="slate">{engine.model ? `modelo ${engine.model}` : 'modelo por defecto del proveedor'}</Badge>
          <Badge tone={llaveActiva ? 'emerald' : 'red'}>{llaveActiva ? 'llave cargada' : 'SIN llave para este proveedor'}</Badge>
          {engine.source === 'env' && <Badge tone="amber">config de entorno: guardá para pasarla al panel</Badge>}
        </div>
      )}
      {engine && !llaveActiva && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Sin llave del proveedor elegido, los bots de todos los clientes responden solo con el aviso de respaldo. Cargala abajo.
        </p>
      )}

      <form className="space-y-5" onSubmit={(e) => void guardar(e)}>
        <Card title="Proveedor, modelo y llaves" description="Las llaves se guardan cifradas y jamás se vuelven a mostrar: vacío = mantener la cargada.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Proveedor">
              <select className={inputClass} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as BotEngine['provider'] })}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
              </select>
            </Field>
            <Field label="Modelo (vacío = el económico por defecto del proveedor)">
              <input className={inputClass} placeholder={form.provider === 'openai' ? 'ej: gpt-4.1-mini' : 'ej: claude-haiku-4-5'} value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </Field>
            <Field label={`Llave de OpenAI ${engine?.keys.openai ? '(cargada ✓)' : '(sin cargar)'}`}>
              <input className={inputClass} type="password" autoComplete="off" placeholder={engine?.keys.openai ? 'vacío = mantener' : 'sk-…'} value={form.openai_api_key} onChange={(e) => setForm({ ...form, openai_api_key: e.target.value })} />
            </Field>
            <Field label={`Llave de Anthropic ${engine?.keys.anthropic ? '(cargada ✓)' : '(sin cargar)'}`}>
              <input className={inputClass} type="password" autoComplete="off" placeholder={engine?.keys.anthropic ? 'vacío = mantener' : 'sk-ant-…'} value={form.anthropic_api_key} onChange={(e) => setForm({ ...form, anthropic_api_key: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card title="Cómo responde" description="Tiempos y avisos que aplican a todos los bots.">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Espera antes de responder (segundos)">
              <input className={inputClass} type="number" min={0} max={120} value={ops.debounce} onChange={(e) => setOps({ ...ops, debounce: Number(e.target.value) })} />
              <span className="mt-0.5 block text-xs text-slate-400">Si el cliente manda varios mensajes seguidos, el bot espera y contesta una sola vez.</span>
            </Field>
            <Field label="Tope horario de IA (presupuesto mensual ÷ este valor)">
              <input className={inputClass} type="number" min={1} max={720} value={ops.divisor} onChange={(e) => setOps({ ...ops, divisor: Number(e.target.value) })} />
              <span className="mt-0.5 block text-xs text-slate-400">Evita que un solo negocio gaste todo su mes en una hora.</span>
            </Field>
            <Field label="Aviso si la IA falla (vacío = texto por defecto)">
              <textarea className={`${inputClass} h-20 text-xs`} placeholder="Gracias por tu mensaje! En breve una persona del equipo te responde por este mismo chat." value={ops.fallback} onChange={(e) => setOps({ ...ops, fallback: e.target.value })} />
            </Field>
            <Field label="Aviso al agotarse el presupuesto del mes (vacío = texto por defecto)">
              <textarea className={`${inputClass} h-20 text-xs`} placeholder="Gracias por escribirnos. En este momento una persona del negocio va a continuar la conversacion por este mismo chat." value={ops.budget} onChange={(e) => setOps({ ...ops, budget: e.target.value })} />
            </Field>
          </div>
        </Card>

        <Card
          title="Guía de atención estándar"
          description="Rige para el bot de TODOS los clientes; vacío = la guía por defecto del sistema. Cada cliente la complementa con sus instrucciones (ADR 0008); las reglas de seguridad no viven acá y no son editables."
        >
          <textarea
            className={`${inputClass} h-48 font-mono text-xs`}
            placeholder="Vacío: rige la guía por defecto (personalidad, identificación del cliente, estilo WhatsApp, datos del negocio). Variables: {{nombre_negocio}}, {{razon_social}}, {{rubro}}, {{direccion}}, {{telefono}}, {{email}}."
            value={basePrompt}
            onChange={(e) => setBasePrompt(e.target.value)}
          />
        </Card>

        <div className="flex justify-end">
          <Button variant="primary" type="submit" loading={guardando}>
            Guardar motor
          </Button>
        </div>
      </form>
    </div>
  );
}
