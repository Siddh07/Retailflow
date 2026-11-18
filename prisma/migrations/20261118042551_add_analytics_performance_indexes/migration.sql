-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");

-- CreateIndex
CREATE INDEX "refunds_created_at_idx" ON "refunds"("created_at");
