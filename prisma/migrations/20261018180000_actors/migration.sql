-- CreateTable
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Actor_nameKey_key" ON "Actor"("nameKey");

-- AlterTable
ALTER TABLE "Workstream" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "Task" ADD COLUMN "ownerId" TEXT;
ALTER TABLE "TaskEvent" ADD COLUMN "ownerId" TEXT;

-- CreateIndex
CREATE INDEX "Workstream_ownerId_idx" ON "Workstream"("ownerId");
CREATE INDEX "Task_ownerId_idx" ON "Task"("ownerId");
CREATE INDEX "TaskEvent_ownerId_idx" ON "TaskEvent"("ownerId");

-- AddForeignKey
ALTER TABLE "Workstream" ADD CONSTRAINT "Workstream_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD CONSTRAINT "Task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- same lock-down as every other table (see enable_rls)
ALTER TABLE "Actor" ENABLE ROW LEVEL SECURITY;

-- Data is backfilled by scripts/backfill-actors.ts (it must use the app's own name-matching function).
