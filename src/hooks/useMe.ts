"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ALL_PERMISSION_KEYS } from "@/lib/permissions";

export type Me = { demo: true } | { demo?: false; user: { id: string; username: string; role: string; mustChangePassword: boolean }; permissions: string[] };

// Prefetched by the page; GET /api/auth/me otherwise. Demo mode: no user, full edit rights.
export function useMe() {
  const q = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => api<Me>("GET", "/api/auth/me"),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const d = q.data;
  return {
    ready: !!d,
    demo: !!d && "demo" in d && d.demo === true,
    user: d && "user" in d ? { username: d.user.username, role: d.user.role } : undefined,
    permissions: d && "permissions" in d ? d.permissions : d ? [...ALL_PERMISSION_KEYS] : [],
  };
}
