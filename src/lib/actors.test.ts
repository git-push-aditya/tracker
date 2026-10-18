import assert from "node:assert/strict";
import { test } from "node:test";
import { actorKey, cleanName } from "./actors";

test("case and spacing variants are the same person", () => {
  for (const v of ["Rohan", "rohan", "  ROHAN ", "Rohan "]) assert.equal(actorKey(v), "rohan");
  assert.equal(actorKey("Rohan   Mehta"), actorKey(" rohan mehta"));
  assert.equal(cleanName("  Rohan   Mehta "), "Rohan Mehta");
});

test("different spellings stay different (no fuzzy matching)", () => {
  assert.notEqual(actorKey("Rohan"), actorKey("Rohn"));
  assert.equal(actorKey("   "), "");
});

test("compatibility forms collapse (NFKC)", () => {
  assert.equal(actorKey("Ｒｏｈａｎ"), "rohan"); // full-width letters
});
