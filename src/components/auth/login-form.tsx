"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Eye, EyeOff, KeyRound, Loader2, Mail } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { describedBy, FormField } from "@/components/shared/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login } from "@/lib/api";
import { emailSchema } from "@/lib/validation";

const schema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
  remember: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

/** Where to go after signing in: the `?next=` page, if it's a path on this site. */
function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", remember: true },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    try {
      await login(values.email, values.password, values.remember);
      router.replace(nextPath());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in. Please try again.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      {error ? (
        <p role="alert" className="rounded-lg border border-loss/25 bg-loss-soft px-3 py-2 text-sm font-medium text-loss">
          {error}
        </p>
      ) : null}
      <FormField id="login-email" label="Email" error={errors.email?.message}>
        <div className="relative">
          <Mail className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="login-email"
            type="email"
            autoComplete="email"
            placeholder="admin@capitaltrade.com"
            className="h-10 pl-9"
            aria-invalid={Boolean(errors.email)}
            aria-describedby={describedBy("login-email", errors.email?.message)}
            {...register("email")}
          />
        </div>
      </FormField>

      <FormField id="login-password" label="Password" error={errors.password?.message}>
        <div className="relative">
          <KeyRound className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className="h-10 px-9"
            aria-invalid={Boolean(errors.password)}
            aria-describedby={describedBy("login-password", errors.password?.message)}
            {...register("password")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute top-1/2 right-2 flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </FormField>

      <div className="flex items-center gap-2">
        <Controller
          control={control}
          name="remember"
          render={({ field }) => (
            <Checkbox id="login-remember" checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
          )}
        />
        <Label htmlFor="login-remember" className="text-sm font-normal text-muted-foreground">
          Remember me
        </Label>
      </div>

      <Button type="submit" disabled={isSubmitting} className="h-11 w-full text-[15px] font-semibold shadow-sm">
        {isSubmitting ? <Loader2 className="animate-spin" aria-hidden /> : null}
        Sign in
        {!isSubmitting ? <ArrowRight aria-hidden /> : null}
      </Button>
    </form>
  );
}
