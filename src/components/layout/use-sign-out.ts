"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { logout } from "@/lib/api";

/** End the session on the server, then go to the sign-in page. */
export function useSignOut(): () => Promise<void> {
  const router = useRouter();
  return async () => {
    try {
      await logout();
    } catch {
      toast.error("Couldn't reach the server to end your session.");
    }
    router.replace("/login");
  };
}
