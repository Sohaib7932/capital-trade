import { ibSchema } from "@/lib/validation";
import { admin, authed, parseMonth, readJson } from "@/server/route";
import { createIB, loadLedger } from "@/server/store";

export const GET = authed(async (request) =>
  (await loadLedger()).ibs(parseMonth(request.nextUrl.searchParams.get("month"), true)),
);

export const POST = admin(async (request, user) => createIB(user, await readJson(request, ibSchema)));
