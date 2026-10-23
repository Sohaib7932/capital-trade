import { existsSync } from "node:fs";

/** Load `.env.local` / `.env` (written by `neon deploy`) for scripts run outside Next.js. */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Run \`neon deploy\` (or \`neon env pull\`) first.`);
  return value;
}
