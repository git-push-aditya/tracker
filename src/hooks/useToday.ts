"use client";
import { useSyncExternalStore } from "react";
import { todayDay } from "@/lib/date";

// null on the server and during hydration (avoids mismatches); then re-checked every 60 s so the
// Today line and overdue → Delayed update when the date rolls over.
const subscribe = (cb: () => void) => { const id = setInterval(cb, 60000); return () => clearInterval(id); };
export const useToday = () => useSyncExternalStore<number | null>(subscribe, todayDay, () => null);
