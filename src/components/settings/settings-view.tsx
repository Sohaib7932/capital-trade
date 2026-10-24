"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useApp } from "@/components/layout/app-context";
import { describedBy, FormField } from "@/components/shared/form-field";
import { PageHeader } from "@/components/shared/page-header";
import { PageSkeleton } from "@/components/shared/skeletons";
import { SplitBar } from "@/components/shared/split-bar";
import { SplitFields } from "@/components/shared/split-fields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { changePassword, updateProfile, updateSettings } from "@/lib/api";
import { timeZoneLabel } from "@/lib/dates";
import { normalizeSymbol } from "@/lib/symbols";
import type { Settings } from "@/lib/types";
import { emailSchema, passwordSchema, splitSchema } from "@/lib/validation";
import { AuditPanel } from "./audit-panel";
import { Mt5Panel } from "./mt5-panel";
import { SettingsCard } from "./settings-card";
import { UsersPanel } from "./users-panel";

const TABS = ["split", "mt5", "profile", "users", "audit"];
const ADMIN_TABS = ["users", "audit"];

export function SettingsView() {
  const { settings, canEdit } = useApp();
  const requested = useSearchParams().get("tab");
  const tab = requested && TABS.includes(requested) && (canEdit || !ADMIN_TABS.includes(requested)) ? requested : "split";
  if (!settings) return <PageSkeleton kpis={0} />;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description={
          canEdit
            ? "Business rules, the MT5 connection, users and the audit log."
            : "You have read-only access. Business settings are shown for reference."
        }
      />
      <Tabs key={tab} defaultValue={tab} className="gap-6">
        <TabsList className="h-auto w-full flex-wrap sm:w-fit">
          <TabsTrigger value="split" className="px-3">
            Profit Split
          </TabsTrigger>
          <TabsTrigger value="mt5" className="px-3">
            MT5 Connection
          </TabsTrigger>
          <TabsTrigger value="profile" className="px-3">
            Profile
          </TabsTrigger>
          {canEdit ? (
            <>
              <TabsTrigger value="users" className="px-3">
                Users
              </TabsTrigger>
              <TabsTrigger value="audit" className="px-3">
                Audit log
              </TabsTrigger>
            </>
          ) : null}
        </TabsList>
        <TabsContent value="split" className="space-y-6">
          <SplitSettings settings={settings} />
          <LossHandlingSettings />
          <IbCommissionSettings settings={settings} />
          <TimezoneSettings settings={settings} />
        </TabsContent>
        <TabsContent value="mt5" className="space-y-6">
          <Mt5Panel />
          <SyncIntervalSettings settings={settings} />
          <GoldSymbolsSettings settings={settings} />
        </TabsContent>
        <TabsContent value="profile" className="space-y-6">
          <ProfileSettings settings={settings} />
          <PasswordSettings />
        </TabsContent>
        {canEdit ? (
          <>
            <TabsContent value="users">
              <UsersPanel currentUserId={settings.profile.id} />
            </TabsContent>
            <TabsContent value="audit">
              <AuditPanel />
            </TabsContent>
          </>
        ) : null}
      </Tabs>
    </div>
  );
}

function SaveBar({ submitting, dirty, label = "Save changes" }: { submitting: boolean; dirty: boolean; label?: string }) {
  return (
    <div className="flex justify-end border-t px-6 py-4">
      <Button type="submit" disabled={submitting || !dirty} className="font-semibold">
        {submitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {label}
      </Button>
    </div>
  );
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : undefined;
}

/** Save a business setting and refresh the whole app (settings live in the app shell). */
function useSaveSettings() {
  const { notifyDataChanged } = useApp();
  return async (update: Parameters<typeof updateSettings>[0], success: string, description?: string) => {
    try {
      const saved = await updateSettings(update);
      toast.success(success, { description });
      notifyDataChanged();
      return saved;
    } catch (err) {
      toast.error("Couldn't save settings", { description: errorMessage(err) });
      return null;
    }
  };
}

// --- Profit split ----------------------------------------------------------

const splitForm = z.object({ split: splitSchema });

function SplitSettings({ settings }: { settings: Settings }) {
  const { canEdit } = useApp();
  const save = useSaveSettings();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<z.infer<typeof splitForm>>({ resolver: zodResolver(splitForm), defaultValues: { split: settings.defaultSplit } });
  const split = useWatch({ control, name: "split" });

  async function onSubmit(values: z.infer<typeof splitForm>) {
    const saved = await save({ defaultSplit: values.split }, "Default split saved", "Applies to clients added from now on.");
    if (saved) reset({ split: saved.defaultSplit });
  }

  return (
    <SettingsCard
      title="Default profit split"
      description="Used for new clients. Each client can override it. Only net profit is split — never invested capital."
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset disabled={!canEdit} className="space-y-5 px-6 py-5">
          <SplitFields
            idPrefix="default-split"
            values={split}
            errors={errors.split}
            fields={{
              trader: register("split.trader", { valueAsNumber: true }),
              company: register("split.company", { valueAsNumber: true }),
              client: register("split.client", { valueAsNumber: true }),
            }}
          />
          <div>
            <p className="eyebrow mb-2">Current default</p>
            <SplitBar split={settings.defaultSplit} />
          </div>
        </fieldset>
        {canEdit ? <SaveBar submitting={isSubmitting} dirty={isDirty} /> : null}
      </form>
    </SettingsCard>
  );
}

// --- Losing months ----------------------------------------------------------

/** Losses always carry forward per client; shown for reference. */
function LossHandlingSettings() {
  return (
    <SettingsCard title="Losing months" description="What happens when a client's month is a loss.">
      <div className="px-6 py-5 text-sm">
        <p className="font-semibold">Losses carry forward per client</p>
        <p className="mt-1 text-muted-foreground">
          If a client&apos;s result since their last split is negative, nothing is split. When profit comes back, the loss is
          recovered first and only the profit above it is split (e.g. October −300, November +1,000 → November splits 700).
        </p>
      </div>
    </SettingsCard>
  );
}

// --- IB commissions ------------------------------------------------------------

function IbCommissionSettings({ settings }: { settings: Settings }) {
  const { canEdit } = useApp();
  const save = useSaveSettings();
  const [pending, setPending] = useState(false);
  const on = settings.ibCommissionsEnabled;

  async function toggle() {
    setPending(true);
    await save(
      { ibCommissionsEnabled: !on },
      on ? "IB commissions turned off" : "IB commissions turned on",
      "Open months were recalculated. Finalized months keep their numbers.",
    );
    setPending(false);
  }

  return (
    <SettingsCard
      title="IB commissions"
      description="Each IB has a rule (percent of their clients' profit, from the company's share or additional). While off, no commission is calculated and commission columns are hidden."
    >
      <div className="flex items-center justify-between gap-4 px-6 py-5">
        <div>
          <p className="text-sm font-semibold">IB commissions are {on ? "on" : "off"}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {on ? "Each IB's rule applies to open months." : "IB pages still show each IB's clients, capital, lots and profit."}
          </p>
        </div>
        {canEdit ? (
          <Button variant={on ? "outline" : "default"} onClick={toggle} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {on ? "Turn off" : "Turn on"}
          </Button>
        ) : null}
      </div>
    </SettingsCard>
  );
}

// --- Sync interval -----------------------------------------------------------------

const INTERVALS = [60, 120, 300, 600, 900, 1800];

function SyncIntervalSettings({ settings }: { settings: Settings }) {
  const { canEdit } = useApp();
  const save = useSaveSettings();
  const [value, setValue] = useState(String(settings.syncIntervalSeconds));
  const [pending, setPending] = useState(false);
  const dirty = value !== String(settings.syncIntervalSeconds);

  return (
    <SettingsCard
      title="Sync interval"
      description="How often the MT5 worker reads every account. It picks up a new value (and new accounts) on its next cycle."
    >
      <div className="flex flex-col gap-3 px-6 py-5 sm:flex-row sm:items-end">
        <FormField id="sync-interval" label="Every" className="sm:w-56">
          <select
            id="sync-interval"
            disabled={!canEdit}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
          >
            {INTERVALS.map((s) => (
              <option key={s} value={s}>
                {s < 120 ? "1 minute" : `${s / 60} minutes`}
                {s === 300 ? " (default)" : ""}
              </option>
            ))}
          </select>
        </FormField>
        {canEdit ? (
          <Button
            disabled={!dirty || pending}
            onClick={async () => {
              setPending(true);
              await save({ syncIntervalSeconds: Number(value) }, "Sync interval saved");
              setPending(false);
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save
          </Button>
        ) : null}
      </div>
    </SettingsCard>
  );
}

// --- Business timezone -------------------------------------------------------

const COMMON_ZONES = ["Asia/Karachi", "Asia/Dubai", "Asia/Kolkata", "Europe/London", "UTC", "America/New_York"];
const ALL_ZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : COMMON_ZONES;

const tzForm = z.object({ businessTimezone: z.string().min(1) });

function TimezoneSettings({ settings }: { settings: Settings }) {
  const { canEdit } = useApp();
  const save = useSaveSettings();
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { isSubmitting, isDirty },
  } = useForm<z.infer<typeof tzForm>>({ resolver: zodResolver(tzForm), defaultValues: { businessTimezone: settings.businessTimezone } });
  const zone = useWatch({ control, name: "businessTimezone" });
  const others = ALL_ZONES.filter((z) => !COMMON_ZONES.includes(z));

  async function onSubmit(values: z.infer<typeof tzForm>) {
    const saved = await save(
      { businessTimezone: values.businessTimezone },
      "Business timezone saved",
      "Open months were recalculated with the new day boundaries.",
    );
    if (saved) reset({ businessTimezone: saved.businessTimezone });
  }

  return (
    <SettingsCard
      title="Business timezone"
      description="Defines a profit 'day' and how dates and times are shown everywhere. Timestamps are stored in UTC."
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset disabled={!canEdit} className="space-y-3 px-6 py-5">
          <FormField
            id="business-timezone"
            label="Timezone"
            hint={zone ? `${zone} is ${timeZoneLabel(zone)}.` : undefined}
          >
            <select
              id="business-timezone"
              className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60"
              aria-describedby={describedBy("business-timezone", undefined, true)}
              {...register("businessTimezone")}
            >
              <optgroup label="Common">
                {COMMON_ZONES.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All timezones">
                {others.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </optgroup>
            </select>
          </FormField>
          <p className="text-xs text-muted-foreground">Changing it recalculates open months only. Finalized months keep their days.</p>
        </fieldset>
        {canEdit ? <SaveBar submitting={isSubmitting} dirty={isDirty} /> : null}
      </form>
    </SettingsCard>
  );
}

// --- Gold symbols ----------------------------------------------------------------

const goldForm = z.object({
  symbols: z
    .string()
    .transform((v) => [...new Set(v.split(/[\s,]+/).map(normalizeSymbol).filter(Boolean))])
    .pipe(
      z
        .array(z.string().regex(/^[A-Z0-9._#+!-]{2,32}$/, "Symbols are 2–32 letters, digits or . _ # + ! -"))
        .min(1, "Keep at least one gold symbol")
        .max(20, "At most 20 symbols"),
    ),
});

function GoldSymbolsSettings({ settings }: { settings: Settings }) {
  const { canEdit } = useApp();
  const save = useSaveSettings();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<z.input<typeof goldForm>, unknown, z.output<typeof goldForm>>({
    resolver: zodResolver(goldForm),
    defaultValues: { symbols: settings.goldSymbols.join(", ") },
  });

  async function onSubmit(values: z.output<typeof goldForm>) {
    const saved = await save({ goldSymbols: values.symbols }, "Gold symbols saved", "Open months were recalculated.");
    if (saved) reset({ symbols: saved.goldSymbols.join(", ") });
  }

  return (
    <SettingsCard
      title="Gold symbols"
      description="Only trades on these symbols count as pool profit. Matching ignores case and broker suffixes, so XAUUSD also matches xauusd, XAUUSDm, XAUUSD.r and XAUUSD.pro."
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <fieldset disabled={!canEdit} className="space-y-3 px-6 py-5">
          <FormField id="gold-symbols" label="Symbols" error={errors.symbols?.message} hint="Comma-separated, e.g. XAUUSD, GOLD">
            <Input
              id="gold-symbols"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(errors.symbols)}
              aria-describedby={describedBy("gold-symbols", errors.symbols?.message, true)}
              {...register("symbols")}
            />
          </FormField>
          <p className="text-xs text-muted-foreground">
            Deals on other symbols are still stored but never counted; the sync raises a warning when one arrives. Changing this
            recalculates open months only.
          </p>
        </fieldset>
        {canEdit ? <SaveBar submitting={isSubmitting} dirty={isDirty} /> : null}
      </form>
    </SettingsCard>
  );
}

// --- Profile (any role) --------------------------------------------------------

const profileForm = z.object({ name: z.string().trim().min(2, "Enter your name"), email: emailSchema });

function ProfileSettings({ settings }: { settings: Settings }) {
  const { notifyDataChanged } = useApp();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<z.infer<typeof profileForm>>({
    resolver: zodResolver(profileForm),
    defaultValues: { name: settings.profile.name, email: settings.profile.email },
  });

  async function onSubmit(values: z.infer<typeof profileForm>) {
    try {
      const saved = await updateProfile(values);
      reset({ name: saved.name, email: saved.email });
      toast.success("Profile saved");
      notifyDataChanged();
    } catch (err) {
      toast.error("Couldn't save profile", { description: errorMessage(err) });
    }
  }

  return (
    <SettingsCard
      title="Profile"
      description={`Your name and sign-in email. Role: ${settings.profile.role === "admin" ? "Admin" : "Viewer (read-only)"}.`}
    >
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-2">
          <FormField id="profile-name" label="Name" error={errors.name?.message}>
            <Input
              id="profile-name"
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={describedBy("profile-name", errors.name?.message)}
              {...register("name")}
            />
          </FormField>
          <FormField id="profile-email" label="Email" error={errors.email?.message}>
            <Input
              id="profile-email"
              type="email"
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={describedBy("profile-email", errors.email?.message)}
              {...register("email")}
            />
          </FormField>
        </div>
        <SaveBar submitting={isSubmitting} dirty={isDirty} />
      </form>
    </SettingsCard>
  );
}

const passwordForm = z
  .object({ current: z.string().min(1, "Enter your current password"), next: passwordSchema, confirm: z.string() })
  .refine((v) => v.next === v.confirm, { message: "Passwords don't match", path: ["confirm"] });

function PasswordSettings() {
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<z.infer<typeof passwordForm>>({ resolver: zodResolver(passwordForm), defaultValues: { current: "", next: "", confirm: "" } });

  async function onSubmit(values: z.infer<typeof passwordForm>) {
    try {
      await changePassword(values.current, values.next);
      reset();
      toast.success("Password changed");
    } catch (err) {
      toast.error("Couldn't change password", { description: errorMessage(err) });
    }
  }

  const fields = [
    { name: "current", label: "Current password", autoComplete: "current-password" },
    { name: "next", label: "New password", autoComplete: "new-password" },
    { name: "confirm", label: "Confirm new password", autoComplete: "new-password" },
  ] as const;

  return (
    <SettingsCard title="Change password" description="At least 8 characters.">
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="grid grid-cols-1 gap-5 px-6 py-5 sm:grid-cols-3">
          {fields.map((f) => (
            <FormField key={f.name} id={`password-${f.name}`} label={f.label} error={errors[f.name]?.message}>
              <Input
                id={`password-${f.name}`}
                type="password"
                autoComplete={f.autoComplete}
                aria-invalid={Boolean(errors[f.name])}
                aria-describedby={describedBy(`password-${f.name}`, errors[f.name]?.message)}
                {...register(f.name)}
              />
            </FormField>
          ))}
        </div>
        <SaveBar submitting={isSubmitting} dirty={isDirty} label="Update password" />
      </form>
    </SettingsCard>
  );
}
