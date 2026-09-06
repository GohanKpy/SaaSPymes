'use client';

import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../../lib/api';
import { useConfirm, useToast } from '../../../../lib/feedback';
import { errorMessage } from '../../../../lib/labels';
import { Badge, Button, Card, ErrorNote } from '../../../../lib/ui';

interface Integration {
  type: string;
  configured: boolean;
  public_config: Record<string, unknown>;
}

/** Google Calendar del negocio (ADR 0007): conectar, reconectar, desconectar. */
export default function CalendarioPage() {
  const toast = useToast();
  const confirmar = useConfirm();
  const [gcal, setGcal] = useState<Integration | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Integration[]>('/integrations')
      .then((rows) => setGcal(rows.find((i) => i.type === 'google_calendar') ?? null))
      .catch((e) => setError(errorMessage(e, 'No se pudo cargar el estado de Google Calendar.')));
  }, []);
  useEffect(() => load(), [load]);

  // Retorno del flujo OAuth (?google=connected|error): aviso y limpieza de la URL.
  useEffect(() => {
    const google = new URLSearchParams(window.location.search).get('google');
    if (google === 'connected') toast.success('Google Calendar conectado');
    if (google === 'error') toast.error('No se pudo conectar Google Calendar: probá de nuevo.');
    if (google) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const conectado = gcal?.configured && gcal.public_config.status === 'connected';
  const email = typeof gcal?.public_config.connected_email === 'string' ? gcal.public_config.connected_email : null;

  async function connect() {
    setBusy(true);
    try {
      const res = await api<{ auth_url: string }>('/integrations/google/connect', { method: 'POST', json: {} });
      window.location.href = res.auth_url;
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirmar({
      title: 'Desconectar Google Calendar',
      message: 'Los turnos dejan de reflejarse en tu calendario y los eventos de Google dejan de bloquear horarios. Podés volver a conectarlo cuando quieras.',
      confirmLabel: 'Desconectar',
    });
    if (!ok) return;
    try {
      await api('/integrations/google_calendar', { method: 'DELETE' });
      toast.success('Google Calendar desconectado');
      load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }

  if (gcal === undefined) return <ErrorNote error={error} />;

  return (
    <>
      <ErrorNote error={error} />
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            Google Calendar
            {conectado ? (
              <Badge tone="emerald">conectado{email ? `: ${email}` : ''}</Badge>
            ) : gcal?.configured ? (
              <Badge tone="red">desconectado: reconectá</Badge>
            ) : (
              <Badge tone="slate">sin conectar</Badge>
            )}
          </span>
        }
        description="Conectá el calendario de Google de tu negocio: cada turno agendado aparece como evento, las cancelaciones lo quitan, y los eventos que cargues a mano en Google bloquean esos horarios en la agenda (nadie te agenda encima). Se conecta una vez con tu cuenta de Google; podés desconectarla cuando quieras."
      >
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy} onClick={() => void connect()}>
            {gcal?.configured ? 'Reconectar' : 'Conectar Google Calendar'}
          </Button>
          {gcal?.configured && (
            <Button variant="danger" onClick={() => void disconnect()}>
              Desconectar
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Cada persona del equipo puede además conectar su Google Calendar personal desde Personal → Fichas: sus eventos privados la sacan de la agenda solo a ella.
        </p>
      </Card>
    </>
  );
}
