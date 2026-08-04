import { NextResponse, type NextRequest } from 'next/server';

// Particion de portales (ADR 0004): la misma app corre como portal de
// clientes o portal de plataforma segun PORTAL. El middleware hace la
// separacion en el servidor: desde un portal no se puede ni ver el otro.
const isAdminPortal = process.env.PORTAL === 'admin';

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const url = request.nextUrl.clone();

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
