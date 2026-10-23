import { mt5AccountSchema } from "@/lib/validation";
import { createAccount, listAccounts } from "@/server/mt5";
import { admin, authed, readJson } from "@/server/route";

export const GET = authed(async () => listAccounts());

export const POST = admin(async (request, user) => createAccount(user, await readJson(request, mt5AccountSchema)));
