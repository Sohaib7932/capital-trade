import type { AdminUser, AuditEntry, AuditQuery, CreateUserInput, Paged, UpdateUserInput } from "@/lib/types";
import type { Queryable } from "./allocations";
import { audit } from "./audit";
import { deleteUserSessions, forgetUserSessions, hashPassword, type SessionUser } from "./auth";
import { pool, transaction } from "./db";
import { badRequest, conflict, notFound } from "./errors";

const USER_COLUMNS = `id, name, email, role, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"`;

export async function listUsers(): Promise<AdminUser[]> {
  const { rows } = await pool().query<AdminUser>(`SELECT ${USER_COLUMNS} FROM admin_users ORDER BY lower(name)`);
  return rows;
}

export async function createUser(actor: SessionUser, input: CreateUserInput): Promise<AdminUser> {
  return transaction(async (tx) => {
    const taken = await tx.query("SELECT 1 FROM admin_users WHERE lower(email) = lower($1)", [input.email]);
    if (taken.rowCount) throw conflict("A user with that email already exists");
    const { rows } = await tx.query<AdminUser>(
      `INSERT INTO admin_users (name, email, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING ${USER_COLUMNS}`,
      [input.name.trim(), input.email.trim(), input.role, await hashPassword(input.password)],
    );
    await audit(tx, actor, {
      action: "user.create",
      entityType: "user",
      entityId: rows[0].id,
      summary: `Added ${input.role} ${input.name.trim()} (${input.email.trim()})`,
    });
    return rows[0];
  });
}

/** Refuse changes that would leave nobody able to administer the app. */
async function assertAnotherAdmin(db: Queryable, userId: string) {
  const { rows } = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM admin_users WHERE role = 'admin' AND id <> $1", [userId]);
  if (rows[0].n === 0) throw badRequest("There must always be at least one admin");
}

export async function updateUser(actor: SessionUser, id: string, input: UpdateUserInput): Promise<AdminUser> {
  const user = await transaction(async (tx) => {
    const before = await tx.query<AdminUser>(`SELECT ${USER_COLUMNS} FROM admin_users WHERE id = $1 FOR UPDATE`, [id]);
    if (!before.rows[0]) throw notFound("User not found");
    if (input.role === "viewer" && before.rows[0].role === "admin") await assertAnotherAdmin(tx, id);

    const { rows } = await tx.query<AdminUser>(
      `UPDATE admin_users SET name = COALESCE($2, name), role = COALESCE($3, role),
              password_hash = COALESCE($4, password_hash)
        WHERE id = $1 RETURNING ${USER_COLUMNS}`,
      [id, input.name?.trim() ?? null, input.role ?? null, input.password ? await hashPassword(input.password) : null],
    );
    const changes = [
      input.name && input.name.trim() !== before.rows[0].name ? "name" : null,
      input.role && input.role !== before.rows[0].role ? `role → ${input.role}` : null,
      input.password ? "password reset" : null,
    ].filter(Boolean);
    await audit(tx, actor, {
      action: "user.update",
      entityType: "user",
      entityId: id,
      summary: `Updated user ${rows[0].email}: ${changes.join(", ") || "no changes"}`,
    });
    return rows[0];
  });
  forgetUserSessions(id);
  // A reset password signs the user out everywhere.
  if (input.password) await deleteUserSessions(id);
  return user;
}

export async function deleteUser(actor: SessionUser, id: string): Promise<void> {
  if (id === actor.id) throw badRequest("You can't delete your own account");
  await transaction(async (tx) => {
    const { rows } = await tx.query<AdminUser>(`SELECT ${USER_COLUMNS} FROM admin_users WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows[0]) throw notFound("User not found");
    if (rows[0].role === "admin") await assertAnotherAdmin(tx, id);
    await tx.query("DELETE FROM admin_users WHERE id = $1", [id]);
    await audit(tx, actor, {
      action: "user.delete",
      entityType: "user",
      entityId: id,
      summary: `Deleted user ${rows[0].name} (${rows[0].email})`,
    });
  });
  forgetUserSessions(id);
}

export async function listAudit(query: AuditQuery): Promise<Paged<AuditEntry>> {
  const pageSize = query.pageSize ?? 25;
  const { rows } = await pool().query<{ rows: AuditEntry[] | null; total: number }>(
    `WITH f AS (SELECT * FROM audit_log WHERE $1::text IS NULL OR action LIKE $1 || '%')
     SELECT
       (SELECT json_agg(r) FROM (
          SELECT id, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, user_email AS "userEmail",
                 action, entity_type AS "entityType", entity_id AS "entityId", summary, details
            FROM f ORDER BY at DESC, id DESC LIMIT $2 OFFSET $3) r) AS rows,
       (SELECT count(*)::int FROM f) AS total`,
    [query.action ?? null, pageSize, (query.page ?? 0) * pageSize],
  );
  return { rows: rows[0].rows ?? [], total: rows[0].total };
}
