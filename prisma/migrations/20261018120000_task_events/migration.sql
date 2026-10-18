-- CreateEnum
CREATE TYPE "TaskEventType" AS ENUM ('COMPLETED', 'DELETED');

-- CreateTable
CREATE TABLE "TaskEvent" (
    "id" TEXT NOT NULL,
    "type" "TaskEventType" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "taskId" TEXT NOT NULL,
    "taskName" TEXT NOT NULL,
    "workstreamId" TEXT NOT NULL,
    "workstreamName" TEXT NOT NULL,
    "owner" TEXT NOT NULL DEFAULT '',
    "actor" TEXT,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TaskEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskEvent_at_id_idx" ON "TaskEvent"("at" DESC, "id" DESC);
CREATE INDEX "TaskEvent_workstreamId_idx" ON "TaskEvent"("workstreamId");
CREATE INDEX "TaskEvent_owner_idx" ON "TaskEvent"("owner");

-- same lock-down as every other table (see enable_rls)
ALTER TABLE "TaskEvent" ENABLE ROW LEVEL SECURITY;

-- Backfill: tasks that are already Done. Their real completion time wasn't recorded, so updatedAt is the best guess.
-- (Tasks deleted before this migration can't be recovered.)
INSERT INTO "TaskEvent" ("id", "type", "at", "taskId", "taskName", "workstreamId", "workstreamName", "owner", "note")
SELECT 'bf_' || t."id", 'COMPLETED', t."updatedAt", t."id", t."name", w."id", w."name", t."owner", 'Backfilled when history was introduced'
FROM "Task" t JOIN "Workstream" w ON w."id" = t."workstreamId"
WHERE t."status" = 'DONE';
