import { z } from "zod";
import { splitSchema } from "@/lib/validation";
import { admin, authed, readJson } from "@/server/route";
import { getSettings, updateSettings } from "@/server/store";

export const GET = authed(async (_request, user) => getSettings(user));

const timezones = new Set(Intl.supportedValuesOf("timeZone"));

const updateSchema = z
  .object({
    defaultSplit: splitSchema.optional(),
    lossHandling: z.enum(["carry_forward", "reset_monthly"]).optional(),
    businessTimezone: z
      .string()
      .refine((tz) => timezones.has(tz), "Unknown timezone")
      .optional(),
    goldSymbols: z
      .array(z.string().trim().regex(/^[A-Za-z0-9._#+!-]{2,32}$/, "Symbols are 2–32 letters, digits or . _ # + ! -"))
      .min(1, "Keep at least one gold symbol")
      .max(20)
      .optional(),
    mt5: z
      .object({
        accountNumber: z.string().trim().regex(/^\d{4,12}$/, "Account number is 4–12 digits"),
        server: z.string().trim().min(2, "Enter the MT5 server name").max(100),
      })
      .optional(),
  })
  .strict();

/** Business settings (admin only). Your own profile is changed via /api/me. */
export const PATCH = admin(async (request, user) => updateSettings(user, await readJson(request, updateSchema)));
