-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CHECKOUT_COMPLETED', 'ORDER_REFUNDED');

-- AlterEnum
ALTER TYPE "MovementKind" ADD VALUE 'REFUND_RESTOCK';

-- CreateTable
CREATE TABLE "checkout_attempts" (
    "cashier_id" UUID NOT NULL,
    "key" VARCHAR(100) NOT NULL,
    "request_hash" VARCHAR(64) NOT NULL,
    "order_id" UUID,
    "receipt_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checkout_attempts_pkey" PRIMARY KEY ("cashier_id","key")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" VARCHAR(255) NOT NULL,
    "restocked" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "action" "AuditAction" NOT NULL,
    "actor_id" UUID NOT NULL,
    "order_id" UUID,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkout_attempts_order_id_key" ON "checkout_attempts"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_order_id_key" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "audit_events_order_id_created_at_idx" ON "audit_events"("order_id", "created_at");

-- AddForeignKey
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movement_rules;

ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movement_rules CHECK (
  length(btrim(reason)) > 0
  AND CASE kind::text
    WHEN 'OPENING' THEN delta > 0 AND order_id IS NULL
    WHEN 'RECEIPT' THEN delta > 0 AND actor_id IS NOT NULL AND order_id IS NULL
    WHEN 'CORRECTION' THEN delta <> 0 AND actor_id IS NOT NULL AND order_id IS NULL
    WHEN 'SALE' THEN delta < 0 AND actor_id IS NOT NULL AND order_id IS NOT NULL
    WHEN 'REFUND_RESTOCK' THEN delta > 0 AND actor_id IS NOT NULL AND order_id IS NOT NULL
    ELSE false
  END
);

ALTER TABLE "refunds" ADD CONSTRAINT "refund_values_valid" CHECK (
  amount > 0 AND length(btrim(reason)) > 0
);

ALTER TABLE "checkout_attempts" ADD CONSTRAINT "checkout_result_fields_paired" CHECK (
  (order_id IS NULL AND receipt_json IS NULL) OR
  (order_id IS NOT NULL AND receipt_json IS NOT NULL)
);

