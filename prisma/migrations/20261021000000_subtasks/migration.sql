-- AlterTable
ALTER TABLE "Task" ADD COLUMN "parentId" TEXT;

-- CreateIndex
CREATE INDEX "Task_parentId_idx" ON "Task"("parentId");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A task can't be its own parent
ALTER TABLE "Task" ADD CONSTRAINT "Task_parent_not_self" CHECK ("parentId" IS NULL OR "parentId" <> "id");
