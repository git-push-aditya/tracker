-- CreateIndex
CREATE INDEX "LoginAttempt_createdAt_idx" ON "LoginAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "RolePermission_permissionId_idx" ON "RolePermission"("permissionId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "TaskDependency_dependsOnId_idx" ON "TaskDependency"("dependsOnId");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- Invariants the app also validates (Zod); enforced here so no code path can break them.
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_progress_range" CHECK ("progress" BETWEEN 0 AND 100),
  ADD CONSTRAINT "Task_end_after_start" CHECK ("end" >= "start"),
  ADD CONSTRAINT "Task_milestone_single_day" CHECK (NOT "isMilestone" OR "start" = "end"),
  ADD CONSTRAINT "Task_done_is_100" CHECK ("status" <> 'DONE' OR "progress" = 100);
ALTER TABLE "TaskDependency"
  ADD CONSTRAINT "TaskDependency_no_self" CHECK ("taskId" <> "dependsOnId");
ALTER TABLE "Workstream"
  ADD CONSTRAINT "Workstream_color_hex" CHECK ("color" ~ '^#[0-9a-f]{6}$');
ALTER TABLE "User"
  ADD CONSTRAINT "User_username_lowercase" CHECK ("username" = lower("username"));
