import { z } from "zod";
import { emailSchema, passwordSchema, roleSchema } from "@/lib/validation";
import { admin, readJson } from "@/server/route";
import { createUser, listUsers } from "@/server/users";

export const GET = admin(async () => listUsers());

const schema = z.object({
  name: z.string().trim().min(2, "Enter a name"),
  email: emailSchema,
  role: roleSchema,
  password: passwordSchema,
});

export const POST = admin(async (request, user) => createUser(user, await readJson(request, schema)));
