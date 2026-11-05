-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sku" VARCHAR(30) NOT NULL,
    "price" INTEGER NOT NULL,
    "stock_quantity" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_is_active_name_id_idx" ON "products"("is_active", "name", "id");

ALTER TABLE "products" ADD CONSTRAINT "products_price_range" CHECK ("price" BETWEEN 0 AND 1000000000);
ALTER TABLE "products" ADD CONSTRAINT "products_stock_range" CHECK ("stock_quantity" BETWEEN 0 AND 1000000);
ALTER TABLE "products" ADD CONSTRAINT "products_name_not_blank" CHECK (length(btrim("name")) > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_sku_format" CHECK ("sku" ~ '^[A-Z0-9-]+$');
