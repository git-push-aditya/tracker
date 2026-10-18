"use client";
import { useState } from "react";
import { actorKey } from "@/lib/actors";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "./ui/select";

// Radix Select rejects "" as an item value, so these stand in for "no owner" and "add a new person".
const NONE = "__none__", NEW = "__new__";

/** Owner picker: existing people, "No owner", or "+ New person…" (turns into a text box). Emits a plain name. */
export function OwnerSelect({ value, onChange, owners }: { value: string; onChange: (name: string) => void; owners: string[] }) {
  const [adding, setAdding] = useState(false);
  const [before, setBefore] = useState(value);
  // the current value is always selectable, even before the people list has loaded
  const options = value && !owners.some((o) => actorKey(o) === actorKey(value)) ? [value, ...owners] : owners;

  if (adding)
    return (
      <div className="flex gap-2">
        <Input autoFocus maxLength={80} placeholder="New person's name" aria-label="New owner name" value={value} onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
          onBlur={() => { // typed a name that already exists → switch back to that person
            const hit = owners.find((o) => actorKey(o) === actorKey(value));
            if (hit) { onChange(hit); setAdding(false); }
          }} />
        <Button type="button" variant="outline" onClick={() => { onChange(before); setAdding(false); }}>Cancel</Button>
      </div>
    );

  return (
    <Select value={value || NONE} onValueChange={(v) => {
      if (v === NEW) { setBefore(value); onChange(""); setAdding(true); }
      else onChange(v === NONE ? "" : v);
    }}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>No owner</SelectItem>
        {options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
        <SelectSeparator />
        <SelectItem value={NEW}>+ New person…</SelectItem>
      </SelectContent>
    </Select>
  );
}
