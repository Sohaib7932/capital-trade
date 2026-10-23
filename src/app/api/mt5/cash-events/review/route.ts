import { z } from "zod";
import { reviewCashEvent } from "@/server/mt5";
import { admin, readJson } from "@/server/route";

const schema = z.object({ accountLogin: z.number().int().positive(), dealTicket: z.number().int().nonnegative() });

/** Mark a cash event as reviewed. It never creates a client transaction — do that by hand if needed. */
export const POST = admin(async (request, user) => {
  const { accountLogin, dealTicket } = await readJson(request, schema);
  await reviewCashEvent(user, accountLogin, dealTicket);
  return null;
});
