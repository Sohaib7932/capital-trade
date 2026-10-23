import type { Queryable } from "./allocations";

export interface Actor {
  id: string;
  email: string;
}

export interface AuditInput {
  /** Dotted verb, e.g. "client.create", "month.finalize". */
  action: string;
  entityType: string;
  entityId?: string;
  /** One readable line for the audit page. */
  summary: string;
  details?: Record<string, unknown>;
}

/** Record who did what. Call inside the same transaction as the change. */
export async function audit(db: Queryable, actor: Actor, entry: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, summary, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      actor.id,
      actor.email,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.summary,
      entry.details ? JSON.stringify(entry.details) : null,
    ],
  );
}

/** Fields whose values differ, as { field: { from, to } }. */
export function diff<T extends object>(before: T, after: Partial<T>): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(after)) {
    const from = (before as Record<string, unknown>)[key];
    if (to !== undefined && JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
  }
  return changes;
}
