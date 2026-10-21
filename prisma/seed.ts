import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { ALL_PERMISSION_KEYS, PERMISSIONS, VIEWONLY_PERMISSION_KEYS } from "../src/lib/permissions";

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL, ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "") ? false : { rejectUnauthorized: false } }),
});

const WORKSTREAMS = [
  ["product", "Product", "#2a78d6"],
  ["tech", "Tech Integrations", "#eb6834"],
  ["growth", "Growth & CRM", "#1baf7a"],
  ["sales", "Sales", "#eda100"],
  ["social", "Social Media", "#e87ba4"],
  ["media", "Media Planner", "#008300"],
  ["hiring", "Hiring", "#4a3aa7"],
] as const;

const FIRST_ADMINS = [
  ["snehpriya", "SEED_PASSWORD_SNEHPRIYA"],
  ["aditya", "SEED_PASSWORD_ADITYA"],
] as const;

async function syncRole(name: string, description: string, keys: readonly string[]) {
  const role = await db.role.upsert({
    where: { name },
    update: { description, isSystem: true },
    create: { name, description, isSystem: true },
  });
  const perms = await db.permission.findMany({ where: { key: { in: [...keys] } } });
  // add-only: never strips permissions an admin granted or revoked later (admin always has all, see keys)
  await db.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })),
    skipDuplicates: true,
  });
  return role;
}

async function main() {
  // Every run: sync permissions + system roles
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, update: { description }, create: { key, description } });
  }
  const admin = await syncRole("admin", "Full access", ALL_PERMISSION_KEYS);
  await syncRole("viewonly", "Read-only access to the dashboard", VIEWONLY_PERMISSION_KEYS);

  // First install only
  if ((await db.user.count()) > 0) return console.log("Seed: synced permissions and roles; users exist, skipping bootstrap.");

  const users = FIRST_ADMINS.map(([username, envVar]) => {
    const password = process.env[envVar];
    if (!password) throw new Error(`${envVar} must be set for the first install`);
    return { username, passwordHash: bcrypt.hashSync(password, 12), roleId: admin.id, mustChangePassword: true };
  });
  await db.$transaction([
    db.user.createMany({ data: users }),
    db.workstream.createMany({
      data: WORKSTREAMS.map(([id, name, color], position) => ({ id, name, color, position })),
    }),
  ]);
  console.log("Seed: first install complete (2 admins, 7 empty workstreams).");
}

main().finally(() => db.$disconnect());
