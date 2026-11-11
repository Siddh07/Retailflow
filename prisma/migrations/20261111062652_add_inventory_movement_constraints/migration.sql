ALTER TABLE products
ADD CONSTRAINT products_threshold_range
CHECK (low_stock_threshold BETWEEN 0 AND 1000000);

ALTER TABLE inventory_movements
ADD CONSTRAINT inventory_movement_rules
CHECK (
  delta <> 0
  AND length(btrim(reason)) > 0
  AND (kind = 'CORRECTION' OR delta > 0)
  AND (kind = 'OPENING' OR actor_id IS NOT NULL)
);

INSERT INTO inventory_movements (
  id,
  product_id,
  kind,
  delta,
  reason
)
SELECT
  gen_random_uuid(),
  id,
  'OPENING',
  stock_quantity,
  'Opening balance when inventory tracking began'
FROM products
WHERE stock_quantity > 0;
