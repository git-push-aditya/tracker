import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" }); // throws → build fails, so a broken migration never goes live

if (process.env.VERCEL_ENV === "production") {
  run("npx prisma migrate deploy");
  run("npx prisma db seed");
}
run("npx next build");
