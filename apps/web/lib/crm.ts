// Constantes compartidas del CRM (lista de clientes + ficha).

export const SOURCES: { value: string; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'recomendacion', label: 'Recomendacion' },
  { value: 'web', label: 'Web' },
  { value: 'local', label: 'Local' },
  { value: 'otro', label: 'Otro' },
];

export function sourceLabel(value: string | null): string {
  return SOURCES.find((s) => s.value === value)?.label ?? '—';
}

export interface CustomFieldDef {
  id: string;
  entity: string;
  code: string;
  label: string;
  fieldType: 'text' | 'number' | 'date' | 'boolean' | 'list' | 'money' | 'url';
  options: string[];
  required: boolean;
  showInForm: boolean;
  isActive: boolean;
  sort: number;
}

export const ACTIVITY_TYPES: { value: string; label: string; task: boolean }[] = [
  { value: 'nota', label: 'Nota', task: false },
  { value: 'llamada', label: 'Llamada', task: false },
  { value: 'reunion', label: 'Reunión', task: false },
  { value: 'tarea', label: 'Tarea', task: true },
  { value: 'seguimiento', label: 'Seguimiento', task: true },
];

export const CONTACT_KINDS: { value: string; label: string }[] = [
  { value: 'phone', label: 'Teléfono' },
  { value: 'email', label: 'Email' },
  { value: 'web', label: 'Web' },
  { value: 'im', label: 'Red social' },
];
