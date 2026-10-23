import { z } from "zod";
import { classifyCashEvent } from "@/server/mt5";
import { admin, readJson } from "@/server/route";

const schema = z.object({
  accountLogin: z.number().int().positive(),
  dealTicket: z.number().int().nonnegative(),
  classification: z.enum(["deposit", "withdrawal", "fee_payment", "ignore"]),
  /** Fee payments: the month whose fee this pays (default: the client's oldest unpaid fee). */
  feeMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

/** Classify a balance operation: deposit / withdrawal change capital, a fee payment pays a month's fee, or ignore. */
export const POST = admin(async (request, user) => {
  await classifyCashEvent(user, await readJson(request, schema));
  return null;
});
