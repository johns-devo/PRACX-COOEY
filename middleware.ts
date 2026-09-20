import { NextRequest, NextResponse } from "next/server";

  const PRACX_ROOT_PAGES = new Set([
  "/dashboard",
  "/integrations",
  "/patients",
  "/claims",
  "/claim-inquiry",
  "/collections",
  "/payments",
  "/reports",
]);

const CARE_ONLY_PREFIXES = [
  "/scheduler",
  "/eligibility",
  "/clinical",
  "/chart",
  "/billing",
];

/**
 * When NEXT_PUBLIC_APP_SURFACE=pracx (port 3004), expose a clean dedicated site:
 *   http://localhost:3004/            → Local login (then dashboard)
 *   http://localhost:3004/integrations
 * Care-ops URLs stay on port 3003 and are redirected away here.
 */
export function middleware(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_APP_SURFACE !== "pracx") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api")
    || pathname.startsWith("/_next")
    || pathname.startsWith("/favicon")
    || pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Let app/page.tsx render the standalone login screen. Rewriting `/` to an
  // authenticated page here creates a redirect loop before a session exists.
  if (pathname === "/" || pathname === "") return NextResponse.next();

  if (CARE_ONLY_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }

  if (PRACX_ROOT_PAGES.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = `/pracx${pathname}`;
    return NextResponse.rewrite(url);
  }

  if (pathname === "/setup" || pathname.startsWith("/setup/")) {
    const url = request.nextUrl.clone();
    url.pathname = `/pracx${pathname}`;
    return NextResponse.rewrite(url);
  }

  if (pathname === "/pracx" || pathname.startsWith("/pracx/")) {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\..*).*)"],
};
