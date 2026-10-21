"use client";
import { useCallback, useMemo } from "react";
import { ZOOM_PX, type Zoom } from "@/lib/gantt-layout";
import { lsStore, useIsClient, useLsValue } from "./storage";

export type Ui = { zoom: Zoom; collapsed: string[]; openCards: string[]; expanded: string[] }; // expanded: parent tasks whose subtasks show in the gantt // detail cards start collapsed, so we remember the open ones
const store = lsStore("primecare.ui.v1"); // same key as refer.html

function parse(raw: string | null): Ui {
  let s: Partial<Ui> = {};
  try { s = JSON.parse(raw ?? "null") ?? {}; } catch {}
  return {
    zoom: s.zoom && s.zoom in ZOOM_PX ? s.zoom : "month",
    collapsed: Array.isArray(s.collapsed) ? s.collapsed : [],
    openCards: Array.isArray(s.openCards) ? s.openCards : [],
    expanded: Array.isArray(s.expanded) ? s.expanded : [],
  };
}

// Per-viewer UI state in localStorage; defaults until the browser value is available.
export function useUiState() {
  const raw = useLsValue(store);
  const ui = useMemo(() => parse(raw), [raw]);
  const setUi = useCallback((patch: (u: Ui) => Partial<Ui>) => {
    const cur = parse(store.get());
    store.set(JSON.stringify({ ...cur, ...patch(cur) }));
  }, []);
  return { ui, setUi, loaded: useIsClient() };
}
