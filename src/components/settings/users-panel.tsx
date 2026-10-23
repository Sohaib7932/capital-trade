"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, Loader2, Trash2, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useApp } from "@/components/layout/app-context";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { columnHelper, DataTable, type DataTableColumn } from "@/components/shared/data-table";
import { DateTime } from "@/components/shared/date-time";
import { EmptyState } from "@/components/shared/empty-state";
import { describedBy, FormField } from "@/components/shared/form-field";
import { PersonCell } from "@/components/shared/person-cell";
import { TableSkeleton } from "@/components/shared/skeletons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAsync } from "@/hooks/use-async";
import { createUser, deleteUser, getUsers, updateUser } from "@/lib/api";
import type { AdminUser, Role } from "@/lib/types";
import { emailSchema, passwordSchema, roleSchema } from "@/lib/validation";
import { SettingsCard } from "./settings-card";

const helper = columnHelper<AdminUser>();

export function UsersPanel({ currentUserId }: { currentUserId: string }) {
  const { dataVersion, notifyDataChanged } = useApp();
  const [version, setVersion] = useState(0);
  const { data: users } = useAsync(getUsers, [dataVersion, version], { keepPreviousData: true });
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState<AdminUser | null>(null);
  const refresh = () => setVersion((v) => v + 1);

  async function changeRole(user: AdminUser, role: Role) {
    try {
      await updateUser(user.id, { role });
      toast.success(`${user.name} is now ${role === "admin" ? "an admin" : "a viewer"}`);
      refresh();
      if (user.id === currentUserId) notifyDataChanged();
    } catch (err) {
      toast.error("Couldn't change role", { description: err instanceof Error ? err.message : undefined });
    }
  }

  const columns: DataTableColumn<AdminUser>[] = [
    helper.accessor("name", {
      header: "User",
      cell: (info) => <PersonCell name={info.getValue()} code={info.row.original.email} />,
    }),
    helper.accessor("role", {
      header: "Role",
      cell: (info) => {
        const user = info.row.original;
        return (
          <Select value={user.role} onValueChange={(role) => changeRole(user, role as Role)}>
            <SelectTrigger className="h-8 w-40" aria-label={`Role for ${user.name}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin">Admin</SelectItem>
              <SelectItem value="viewer">Viewer (read-only)</SelectItem>
            </SelectContent>
          </Select>
        );
      },
    }),
    helper.accessor("createdAt", {
      header: "Added",
      cell: (info) => <DateTime value={info.getValue()} className="text-xs text-muted-foreground" />,
    }),
    helper.display({
      id: "actions",
      header: "Actions",
      meta: { align: "right" },
      cell: (info) => {
        const user = info.row.original;
        return (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="outline" onClick={() => setResetting(user)}>
              <KeyRound aria-hidden /> Reset password
            </Button>
            {user.id !== currentUserId ? (
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-loss hover:text-loss"
                onClick={() => setDeleting(user)}
                aria-label={`Delete ${user.name}`}
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </div>
        );
      },
    }),
  ];

  return (
    <SettingsCard
      wide
      title="Users"
      description="Admins can change everything. Viewers can see every page but can't change anything."
    >
      <div className="flex justify-end border-b px-6 py-3">
        <Button onClick={() => setAdding(true)}>
          <UserPlus aria-hidden /> Add user
        </Button>
      </div>
      {users ? (
        <DataTable
          columns={columns}
          data={users}
          getRowId={(u) => u.id}
          empty={<EmptyState icon={Users} title="No users" />}
        />
      ) : (
        <TableSkeleton rows={3} columns={4} />
      )}

      <AddUserDialog open={adding} onOpenChange={setAdding} onSaved={refresh} />
      <ResetPasswordDialog user={resetting} onOpenChange={(open) => !open && setResetting(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this user?"
        description={
          deleting ? (
            <>
              <strong className="text-foreground">{deleting.name}</strong> ({deleting.email}) will be signed out and can no longer
              sign in. Their past actions stay in the audit log.
            </>
          ) : null
        }
        confirmLabel="Delete user"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await deleteUser(deleting.id);
            toast.success("User deleted");
            refresh();
          } catch (err) {
            toast.error("Couldn't delete user", { description: err instanceof Error ? err.message : undefined });
            throw err;
          }
        }}
      />
    </SettingsCard>
  );
}

const addSchema = z.object({ name: z.string().trim().min(2, "Enter a name"), email: emailSchema, role: roleSchema, password: passwordSchema });

function AddUserDialog({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof addSchema>>({
    resolver: zodResolver(addSchema),
    defaultValues: { name: "", email: "", role: "viewer", password: "" },
  });

  async function onSubmit(values: z.infer<typeof addSchema>) {
    try {
      await createUser(values);
      toast.success(`${values.name} added`, { description: "Share the temporary password with them securely." });
      reset();
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error("Couldn't add user", { description: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>They sign in with this email and the temporary password, then change it in Settings → Profile.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <FormField id="user-name" label="Name" error={errors.name?.message}>
            <Input id="user-name" aria-invalid={Boolean(errors.name)} aria-describedby={describedBy("user-name", errors.name?.message)} {...register("name")} />
          </FormField>
          <FormField id="user-email" label="Email" error={errors.email?.message}>
            <Input
              id="user-email"
              type="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy("user-email", errors.email?.message)}
              {...register("email")}
            />
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField id="user-role" label="Role">
              <Controller
                control={control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="user-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="viewer">Viewer (read-only)</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            <FormField id="user-password" label="Temporary password" error={errors.password?.message}>
              <Input
                id="user-password"
                type="password"
                autoComplete="new-password"
                aria-invalid={Boolean(errors.password)}
                aria-describedby={describedBy("user-password", errors.password?.message)}
                {...register("password")}
              />
            </FormField>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="font-semibold">
              {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null} Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const resetSchema = z.object({ password: passwordSchema });

function ResetPasswordDialog({ user, onOpenChange }: { user: AdminUser | null; onOpenChange: (open: boolean) => void }) {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: "" } });

  async function onSubmit(values: z.infer<typeof resetSchema>) {
    if (!user) return;
    try {
      await updateUser(user.id, { password: values.password });
      toast.success(`Password reset for ${user.name}`, { description: "They have been signed out everywhere." });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error("Couldn't reset password", { description: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>Set a new password for {user?.name}. They will be signed out of every device.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
          <FormField id="reset-password" label="New password" error={errors.password?.message}>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={describedBy("reset-password", errors.password?.message)}
              {...register("password")}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="font-semibold">
              {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null} Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
