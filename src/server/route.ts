import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { MonthKey, Role } from "@/lib/types";
import { requireUser, SESSION_COOKIE, type SessionUser } from "./auth";
import { badRequest, HttpError } from "./errors";

/** Turn any thrown error into a `{ detail }` JSON response. */
export function errorResponse(err: unknown): NextResponse {
  // Let Next.js handle its own control-flow errors (e.g. bailing out of prerendering).
  unstable_rethrow(err);
  if (err instanceof HttpError) {
    const res = NextResponse.json({ detail: err.message }, { status: err.status });
    // A stale cookie would keep bouncing the user between pages and /login.
    if (err.status === 401) res.cookies.delete(SESSION_COOKIE);
    return res;
  }
  if (err instanceof z.ZodError) {
    const issue = err.issues[0];
    const field = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return NextResponse.json({ detail: issue ? `${field}${issue.message}` : "Invalid request" }, { status: 400 });
  }
  console.error(err);
  return NextResponse.json({ detail: "Something went wrong. Please try again." }, { status: 500 });
}

/**
 * Wrap a route handler: require a signed-in user (an admin when `role: "admin"`),
 * return the handler's result as JSON (or a Response as-is), and map errors to status codes.
 */
export function authed<Ctx>(
  handler: (request: NextRequest, user: SessionUser, ctx: Ctx) => Promise<unknown>,
  options: { role?: Role } = {},
) {
  return async (request: NextRequest, ctx: Ctx): Promise<Response> => {
    try {
      const user = await requireUser(request, options);
      const result = await handler(request, user, ctx);
      return result instanceof Response ? result : NextResponse.json(result ?? null);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Shorthand for handlers that change data: admins only. */
export function admin<Ctx>(handler: (request: NextRequest, user: SessionUser, ctx: Ctx) => Promise<unknown>) {
  return authed(handler, { role: "admin" });
}

export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Month must look like 2026-10");

export function parseMonth(value: string | null | undefined): MonthKey;
export function parseMonth(value: string | null | undefined, optional: true): MonthKey | undefined;
export function parseMonth(value: string | null | undefined, optional = false): MonthKey | undefined {
  if (!value) {
    if (optional) return undefined;
    throw badRequest("A month is required");
  }
  return monthSchema.parse(value);
}

/** Validate the query string against a zod schema. */
export function readQuery<T>(request: NextRequest, schema: z.ZodType<T>): T {
  return schema.parse(Object.fromEntries(request.nextUrl.searchParams));
}

export async function readJson<T>(request: NextRequest, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await request.json().catch(() => {
    throw badRequest("Request body must be JSON");
  });
  return schema.parse(body);
}

/** Common paging params. */
export const pageSchema = {
  page: z.coerce.number().int().min(0).default(0),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
};
