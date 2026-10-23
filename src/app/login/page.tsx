import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { LogoMark } from "@/components/layout/logo";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-12">
      <div
        className="pointer-events-none absolute top-0 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-gold-soft blur-3xl"
        aria-hidden
      />
      <div className="relative w-full max-w-sm">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-[0_8px_30px_rgb(28_25_23/0.06)]">
          <div className="px-7 pt-8 pb-7">
            <div className="mb-7 flex flex-col items-center text-center">
              <LogoMark className="mb-4 size-11" />
              <h1 className="text-lg font-bold tracking-tight">CapitalTrade Advisor</h1>
              <p className="eyebrow mt-1.5">Gold (XAUUSD) investment admin</p>
            </div>
            <LoginForm />
          </div>
          <p className="border-t bg-muted/40 px-7 py-4 text-center text-xs leading-relaxed text-muted-foreground">
            For authorized administrators only. Contact the account owner if you need access.
          </p>
        </div>
      </div>
    </main>
  );
}
