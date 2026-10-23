import { z } from "zod";
import { emailSchema } from "@/lib/validation";
import { authed, readJson } from "@/server/route";
import { updateSettings } from "@/server/store";

/** The signed-in user (any role). */
export const GET = authed(async (_request, user) => user);

const schema = z.object({ name: z.string().trim().min(2, "Enter your name"), email: emailSchema });

/** Update your own name and email (any role). */
export const PATCH = authed(async (request, user) => {
  const settings = await updateSettings(user, { profile: await readJson(request, schema) });
  return settings.profile;
});
