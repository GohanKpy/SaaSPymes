import { NextResponse, type NextRequest } from 'next/server';

// Particion de portales (ADR 0004): la misma app corre como portal de
// clientes o portal de plataforma segun PORTAL. El middleware hace la
// separacion en el servidor: desde un portal no se puede ni ver el otro.
const isAdminPortal = process.env.PORTAL === 'admin';

/** Host del laboratorio: localhost o IP de red privada (RFC 1918). */
function esHostLocal(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const url = request.nextUrl.clone();

  // "Always Use HTTPS" a nivel aplicacion (2026-09-01): el proxy/tunel dice
  // en x-forwarded-proto con que esquema entro el visitante. Entrar por http
  // manda la contrasena en claro y rompia la conexion con la API (bug del
  // 2026-08-31), asi que se corrige antes de servir nada. Solo actua con el
  // header EXPLICITO en 'http' y en dominios publicos: el laboratorio por
  // localhost/LAN (sin proxy, sin header) sigue funcionando por http.
  // El destino se arma con el header `host` (el dominio publico): nextUrl
  // trae el host INTERNO del contenedor y redirigiria a localhost.
  const proto = request.headers.get('x-forwarded-proto');
  const hostHeader = request.headers.get('host') ?? '';
  const host = hostHeader.split(':')[0] ?? '';
  if (proto === 'http' && host && !esHostLocal(host)) {
    return NextResponse.redirect(`https://${host}${pathname}${request.nextUrl.search}`, 308);
  }

  // La guia de uso es un HTML estatico visible desde ambos portales.
  if (pathname === '/guia.html') return NextResponse.next();

  if (isAdminPortal) {
    if (!pathname.startsWith('/platform')) {
      url.pathname = '/platform';
      return NextResponse.redirect(url);
    }
  } else if (pathname.startsWith('/platform')) {
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Assets estaticos quedan fuera; todo lo demas pasa por la particion.
  matcher: ['/((?!_next/|favicon.ico).*)'],
};
