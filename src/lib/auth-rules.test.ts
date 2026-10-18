import assert from "node:assert/strict";
import { test } from "node:test";
import { can, checkUserChange, isRateLimited } from "./auth-rules";

const admin = { id: "a", isActive: true, isAdmin: true };
const other = { id: "b", isActive: true, isAdmin: false };

test("can", () => {
  assert.ok(can(["task:update"], "task:update"));
  assert.ok(!can(["dashboard:read"], "task:update"));
});

test("checkUserChange: self", () => {
  assert.equal(checkUserChange({ actorId: "a", target: admin, change: { type: "delete" }, activeAdminCount: 2 }), "SELF_DELETE");
  assert.equal(checkUserChange({ actorId: "a", target: admin, change: { type: "update", isActive: false }, activeAdminCount: 2 }), "SELF_DELETE");
});

test("checkUserChange: last admin", () => {
  const c = { actorId: "b", target: admin, activeAdminCount: 1 };
  assert.equal(checkUserChange({ ...c, change: { type: "delete" } }), "LAST_ADMIN");
  assert.equal(checkUserChange({ ...c, change: { type: "update", isActive: false } }), "LAST_ADMIN");
  assert.equal(checkUserChange({ ...c, change: { type: "update", isAdmin: false } }), "LAST_ADMIN");
});

test("checkUserChange: allowed", () => {
  assert.equal(checkUserChange({ actorId: "b", target: admin, change: { type: "delete" }, activeAdminCount: 2 }), "ok");
  assert.equal(checkUserChange({ actorId: "a", target: other, change: { type: "delete" }, activeAdminCount: 1 }), "ok");
  assert.equal(checkUserChange({ actorId: "a", target: admin, change: { type: "update", isAdmin: false }, activeAdminCount: 2 }), "ok"); // self-demote with another admin left
});

test("isRateLimited boundary", () => {
  assert.ok(!isRateLimited(4));
  assert.ok(isRateLimited(5));
});
