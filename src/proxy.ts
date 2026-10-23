import { NextResponse, type NextRequest } from "next/server";

/**
 * Send visitors without a session cookie to /login. This is only a fast
 * redirect: every API route verifies the session against the database, and an
 * expired session is cleared there (see src/server/route.ts).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has("ct_session")) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/dashboard/:path*", "/clients/:path*", "/ibs/:path*", "/trades/:path*", "/profit-split/:path*", "/settings/:path*"],
};
