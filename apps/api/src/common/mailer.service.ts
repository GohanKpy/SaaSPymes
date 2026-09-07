import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';

import { MailSettingsService } from '../platform/mail-settings.service';

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

/**
 * Envio de correo (2026-09-07) con la configuracion del portal admin (o el
 * SMTP del entorno). Un transporte por configuracion vigente; los errores se
 * propagan para que quien envia decida (aviso al dueño, log).
 */
@Injectable()
export class MailerService {
  private readonly logger = new Logger('Mailer');

  constructor(private readonly settings: MailSettingsService) {}

  async send(msg: MailMessage): Promise<{ messageId: string }> {
    const c = await this.settings.getConfig();
    const transport = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      ...(c.user && c.password ? { auth: { user: c.user, pass: c.password } } : {}),
    });
    const info = await transport.sendMail({
      from: `"${c.fromName.replace(/"/g, '')}" <${c.fromEmail}>`,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      attachments: msg.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    this.logger.log(`correo enviado a ${msg.to} via ${c.host}:${c.port} (${c.source})`);
    return { messageId: String(info.messageId ?? '') };
  }
}
