-- CreateEnum
CREATE TYPE "MovementKind" AS ENUM ('OPENING', 'RECEIPT', 'SALE', 'CORRECTION');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "barcode" VARCHAR(100),
ADD COLUMN     "cost_price" INTEGER,
ADD COLUMN     "low_stock_threshold" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" "MovementKind" NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "actor_id" UUID,
    "order_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inventory_movements_product_id_created_at_idx" ON "inventory_movements"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_actor_id_idx" ON "inventory_movements"("actor_id");

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
