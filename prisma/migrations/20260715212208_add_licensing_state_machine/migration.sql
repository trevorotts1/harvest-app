-- CreateTable
CREATE TABLE "LicensingRecord" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "license_number" TEXT,
    "issued_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "LicensingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LicensingStateEvent" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "from_state" TEXT NOT NULL,
    "to_state" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_role" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LicensingStateEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LicensingRecord_user_id_idx" ON "LicensingRecord"("user_id");

-- CreateIndex
CREATE INDEX "LicensingRecord_jurisdiction_state_idx" ON "LicensingRecord"("jurisdiction", "state");

-- CreateIndex
CREATE UNIQUE INDEX "LicensingRecord_user_id_jurisdiction_key" ON "LicensingRecord"("user_id", "jurisdiction");

-- CreateIndex
CREATE INDEX "LicensingStateEvent_user_id_created_at_idx" ON "LicensingStateEvent"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "LicensingStateEvent_jurisdiction_created_at_idx" ON "LicensingStateEvent"("jurisdiction", "created_at");
