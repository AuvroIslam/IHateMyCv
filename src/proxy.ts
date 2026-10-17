import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, storageMode } from '@/lib/backend';
import { LOCAL_WORKSPACE, WORKSPACE_COOKIE, WORKSPACE_ID, newWorkspaceId, perBrowserWorkspaces } from '@/lib/workspace-id';

/**
 * Runs before every page and API request:
 * - With APP_PASSWORD set, asks for it (HTTP basic auth, any user name) -
 *   a gate for a private beta.
 * - With Firebase, sends visitors who are not signed in to /login.
 * - With local files, gives a browser without one its workspace cookie,
 *   visible to the request that created it as well as every later one.
 */
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (password) {
    const header = request.headers.get('authorization') ?? '';
    const given = header.startsWith('Basic ') ? atob(header.slice(6)).split(':').slice(1).join(':') : null;
    if (given !== password) {
      return new NextResponse('Password required.', {
        status: 401,
        headers: { 'www-authenticate': 'Basic realm="I Hate My CV", charset="UTF-8"' },
      });
    }
  }

  // With Firebase, the session cookie is the workspace. Pages need one (the
  // API routes verify it themselves and answer 401 without it).
  if (storageMode() === 'firebase') {
    const { pathname, search } = request.nextUrl;
    const open = pathname === '/login' || pathname.startsWith('/api/');
    if (!open && !request.cookies.has(SESSION_COOKIE)) {
      const login = new URL('/login', request.url);
      if (pathname !== '/') login.searchParams.set('next', pathname + search);
      return NextResponse.redirect(login);
    }
    return NextResponse.next();
  }

  const existing = request.cookies.get(WORKSPACE_COOKIE)?.value;
  const shared = !perBrowserWorkspaces();
  // Shared mode uses only the local workspace; per-browser mode never does.
  if (existing && WORKSPACE_ID.test(existing) && shared === (existing === LOCAL_WORKSPACE)) return NextResponse.next();

  const id = shared ? LOCAL_WORKSPACE : newWorkspaceId();
  const headers = new Headers(request.headers);
  const others = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((c) => c.trim())
    .filter((c) => c && !c.startsWith(`${WORKSPACE_COOKIE}=`));
  headers.set('cookie', [...others, `${WORKSPACE_COOKIE}=${id}`].join('; '));
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(WORKSPACE_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 400,
  });
  return response;
}

export const config = {
  // Everything but Next's own static files.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|fonts/|pdf.worker).*)'],
};
