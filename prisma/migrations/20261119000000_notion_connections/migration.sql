-- CreateTable
CREATE TABLE "NotionConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workspace" TEXT NOT NULL,
    "icon" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotionConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotionConnection_userId_workspaceId_key" ON "NotionConnection"("userId", "workspaceId");

-- AddForeignKey
ALTER TABLE "NotionConnection" ADD CONSTRAINT "NotionConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same as every table: no access through Supabase's REST roles (see 20261018000000_enable_rls).
ALTER TABLE "NotionConnection" ENABLE ROW LEVEL SECURITY;
