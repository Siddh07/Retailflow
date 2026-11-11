-- DropIndex
DROP INDEX "inventory_movements_product_id_created_at_idx";

-- AlterTable
ALTER TABLE "products" ALTER COLUMN "low_stock_threshold" SET DEFAULT 5;

-- CreateIndex
CREATE INDEX "inventory_movements_product_id_created_at_id_idx" ON "inventory_movements"("product_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "inventory_movements_order_id_idx" ON "inventory_movements"("order_id");
