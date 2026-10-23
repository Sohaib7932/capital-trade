import { z } from "zod";
import { admin, pageSchema, readQuery } from "@/server/route";
import { listAudit } from "@/server/users";

const schema = z.object({
  action: z.string().regex(/^[a-z.]{1,40}$/, "Unknown action filter").optional(),
  ...pageSchema,
});

/** Who did what, newest first (admin only). */
export const GET = admin(async (request) => listAudit(readQuery(request, schema)));
