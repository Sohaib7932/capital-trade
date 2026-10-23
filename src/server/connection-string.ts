/**
 * Neon connection strings use `sslmode=require`. node-postgres warns that its
 * meaning will change; ask for full certificate verification explicitly (Neon
 * serves publicly trusted certificates), without editing the Neon-managed env file.
 */
export function withVerifiedSsl(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
