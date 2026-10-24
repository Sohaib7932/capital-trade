import { z } from "zod";
import { createClientSchema } from "@/lib/validation";
import { admin, authed, monthSchema, pageSchema, readJson, readQuery } from "@/server/route";
import { createClient, loadLedger } from "@/server/store";

const querySchema = z.object({
  month: monthSchema.optional(),
  ibId: z.string().max(40).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  search: z.string().max(100).optional(),
  sort: z
    .enum(["fullName", "ibName", "investedCapital", "joinedAt", "monthProfit", "monthNetProfit", "totalProfit", "carriedLoss"])
    .optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  ...pageSchema,
  pageSize: z.coerce.number().int().min(1).max(500).default(10),
});

/** Clients, filtered, sorted and paged on the server. */
export const GET = authed(async (request) => (await loadLedger()).clients(readQuery(request, querySchema)));

export const POST = admin(async (request, user) => createClient(user, await readJson(request, createClientSchema)));
