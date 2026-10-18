"use client";
import { useEffect } from "react";
import { lsStore, useIsClient, useLsValue } from "./storage";

const THEMES = ["system", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const store = lsStore("primecare.theme"); // same key as refer.html; layout.tsx applies it before first paint

export function useTheme() {
  const raw = useLsValue(store);
  const theme: Theme = THEMES.find((t) => t === raw) ?? "system";
  const client = useIsClient();

  useEffect(() => {
    if (!client) return; // don't undo what the no-flash script set during hydration
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme, client]);

  return {
    label: "Theme: " + theme[0].toUpperCase() + theme.slice(1),
    cycle: () => store.set(THEMES[(THEMES.indexOf(theme) + 1) % 3]),
  };
}
