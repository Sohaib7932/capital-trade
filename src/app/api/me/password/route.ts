import { z } from "zod";
import { passwordSchema } from "@/lib/validation";
import { authed, readJson } from "@/server/route";
import { changePassword } from "@/server/store";

const schema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: passwordSchema });

/** Change your own password (any role). */
export const POST = authed(async (request, user) => {
  const { currentPassword, newPassword } = await readJson(request, schema);
  await changePassword(user, currentPassword, newPassword);
  return null;
});
