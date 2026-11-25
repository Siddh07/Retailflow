ALTER TABLE inventory_movements DROP CONSTRAINT inventory_movement_rules;

ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movement_rules CHECK (
  length(btrim(reason)) > 0
  AND CASE kind::text
    WHEN 'OPENING' THEN delta > 0 AND order_id IS NULL
    WHEN 'RECEIPT' THEN delta > 0 AND actor_id IS NOT NULL AND order_id IS NULL
    WHEN 'CORRECTION' THEN delta <> 0 AND actor_id IS NOT NULL AND order_id IS NULL
    WHEN 'SALE' THEN delta < 0 AND actor_id IS NOT NULL AND order_id IS NOT NULL
    ELSE false
  END
);
