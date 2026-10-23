import { z } from "zod";
import { passwordSchema, roleSchema } from "@/lib/validation";
import { admin, readJson } from "@/server/route";
import { deleteUser, updateUser } from "@/server/users";

const schema = z
  .object({
    name: z.string().trim().min(2, "Enter a name").optional(),
    role: roleSchema.optional(),
    password: passwordSchema.optional(),
  })
  .strict();

export const PATCH = admin(async (request, user, ctx: RouteContext<"/api/users/[id]">) => {
  const { id } = await ctx.params;
  return updateUser(user, id, await readJson(request, schema));
});

export const DELETE = admin(async (_request, user, ctx: RouteContext<"/api/users/[id]">) => {
  const { id } = await ctx.params;
  await deleteUser(user, id);
  return null;
});
