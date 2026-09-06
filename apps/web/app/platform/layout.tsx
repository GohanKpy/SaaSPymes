'use client';

import type { ReactNode } from 'react';

import { FeedbackProvider } from '../../lib/feedback';

/**
 * Layout del portal admin (fase 0, 2026-09-05): por ahora solo monta los
 * dialogos y avisos del sistema. El menu lateral persistente y las paginas
 * separadas llegan en la fase 3 de la auditoria de paneles.
 */
export default function PlatformLayout({ children }: { children: ReactNode }) {
  return <FeedbackProvider>{children}</FeedbackProvider>;
}
