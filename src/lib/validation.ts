import { z } from "zod";
import { isValidSplit } from "./calculations";

const percent = z
  .number({ error: "Enter a number" })
  .min(0, "Can't be negative")
  .max(100, "Can't exceed 100");

/** Trader / company / client percentages that must total exactly 100. */
export const splitSchema = z
  .object({ trader: percent, company: percent, client: percent })
  .refine(isValidSplit, { message: "Percentages must add up to 100%", path: ["total"] });

/** Positive amount with up to 2 decimals; commas allowed ("25,000.50"). */
export const moneySchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/,/g, ""))
  .pipe(
    z
      .string()
      .min(1, "Enter an amount")
      .regex(/^\d+(\.\d{1,2})?$/, "Use a number with up to 2 decimals")
      .refine((v) => Number(v) > 0, "Amount must be greater than zero"),
  );

export const phoneSchema = z
  .string()
  .trim()
  .min(7, "Enter a phone number")
  .regex(/^[+()\d\s-]+$/, "Only digits, spaces, +, - and ()");

export const emailSchema = z.email("Enter a valid email").trim();

export const isoDateSchema = z.iso.date("Choose a valid date");
export const notesSchema = z.string().trim().max(500, "Keep notes under 500 characters").optional();
export const passwordSchema = z.string().min(8, "Use at least 8 characters").max(200);
export const roleSchema = z.enum(["admin", "viewer"]);

export const ibCommissionSchema = z.object({
  percent: z.number({ error: "Enter a number" }).min(0, "Can't be negative").max(100, "Can't exceed 100"),
  source: z.enum(["from_company_share", "additional"]),
});

export const createClientSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the client's full name"),
  phone: phoneSchema,
  email: emailSchema,
  ibId: z.string().min(1, "Choose the IB who introduced this client"),
  investedAmount: moneySchema,
  investmentDate: isoDateSchema,
  split: splitSchema,
  notes: notesSchema,
});

export const updateClientSchema = z.object({
  fullName: z.string().trim().min(2, "Enter the client's full name"),
  phone: phoneSchema,
  email: emailSchema,
  ibId: z.string().min(1, "Choose an IB"),
  status: z.enum(["active", "inactive"]),
  split: splitSchema,
  notes: notesSchema,
});

export const transactionSchema = z.object({
  type: z.enum(["deposit", "withdrawal"]),
  amount: moneySchema,
  date: isoDateSchema,
  note: notesSchema,
});

export const ibSchema = z.object({
  name: z.string().trim().min(2, "Enter the IB's name"),
  phone: phoneSchema,
  email: emailSchema,
  commission: ibCommissionSchema,
  notes: notesSchema,
});

export const updateIBSchema = ibSchema.extend({ status: z.enum(["active", "inactive"]) });

export const tradeFilterSchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  type: z.enum(["buy", "sell"]).optional(),
});

export const mt5AccountSchema = z.object({
  label: z.string().trim().min(2, "Give the account a name").max(80),
  login: z.number({ error: "Enter the MT5 login number" }).int().positive("Enter the MT5 login number").max(Number.MAX_SAFE_INTEGER),
  server: z.string().trim().min(2, "Enter the broker server name exactly as in MT5").max(100),
  brokerTimezoneOffsetMinutes: z
    .number({ error: "Enter the offset in minutes" })
    .int()
    .min(-720, "Between −720 and 840")
    .max(840, "Between −720 and 840"),
  isActive: z.boolean(),
  linkedClientId: z.string().max(40).nullable(),
});
