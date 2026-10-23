import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  assertLoginAllowed,
  clientIp,
  createSession,
  findUserByEmail,
  recordLoginAttempt,
  SESSION_COOKIE,
  verifyPassword,
} from "@/server/auth";
import { unauthorized } from "@/server/errors";
import { errorResponse, readJson } from "@/server/route";

const schema = z.object({
  email: z.string().trim().min(1, "Enter your email").max(320),
  password: z.string().min(1, "Enter your password").max(200),
  remember: z.boolean().default(false),
});

export async function POST(request: NextRequest) {
  try {
    const { email, password, remember } = await readJson(request, schema);
    const ip = clientIp(request);
    await assertLoginAllowed(email, ip);

    const user = await findUserByEmail(email);
    // Same message whether the email or the password is wrong.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      await recordLoginAttempt(email, ip, false);
      throw unauthorized("Incorrect email or password");
    }
    await recordLoginAttempt(email, ip, true);

    const { token, expiresAt } = await createSession(user.id, remember);
    const res = NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role });
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      // Without "remember me" the cookie ends with the browser session.
      ...(remember ? { expires: expiresAt } : {}),
    });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
