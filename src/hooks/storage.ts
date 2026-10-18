"use client";
import { useSyncExternalStore } from "react";

export function lsGet(k: string) {
  try { return localStorage.getItem(k); } catch { return null; }
}
export function lsSet(k: string, v: string) {
  try { localStorage.setItem(k, v); return true; } catch { return false; }
}

// localStorage as an external store for useSyncExternalStore: the server snapshot is null, so SSR and the
// hydration render agree, then React re-renders with the stored value. Writes notify this tab and others.
const EVENT = "pc-storage";
export function lsStore(key: string) {
  return {
    subscribe(cb: () => void) {
      const onStorage = (e: StorageEvent) => e.key === key && cb();
      addEventListener(EVENT, cb);
      addEventListener("storage", onStorage);
      return () => { removeEventListener(EVENT, cb); removeEventListener("storage", onStorage); };
    },
    get: () => lsGet(key),
    set(v: string) { lsSet(key, v); dispatchEvent(new Event(EVENT)); },
  };
}
export const useLsValue = (store: ReturnType<typeof lsStore>) => useSyncExternalStore(store.subscribe, store.get, () => null);

// false during server render and hydration, true afterwards
const noop = () => () => {};
export const useIsClient = () => useSyncExternalStore(noop, () => true, () => false);
