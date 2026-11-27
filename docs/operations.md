# RetailFlow API — Operations Runbook

## 1. Diagnosing a Failed Request Using `X-Request-ID` (P9-15)

Every HTTP response from RetailFlow API includes an `X-Request-ID` header (assigned by [request-logger.ts](../src/middleware/request-logger.ts)), and every request emits a single-line JSON log containing `timestamp`, `requestId`, `method`, `path`, `statusCode`, and `durationMs`.

### Step-by-Step Diagnosis
1. **Collect the Request ID:** Ask the user/client or inspect the browser Network tab / API error headers for `X-Request-ID` (e.g., `d4f128bc-9a12-4c11-90ef-1234567890ab`).
2. **Search Logs by `requestId`:**
   - **Docker Compose / Local:**
     ```bash
     docker logs retailflow-api 2>&1 | grep "d4f128bc-9a12-4c11-90ef-1234567890ab"
     ```
   - **Render / Cloud Host:** Open the **Logs** tab and filter by the `requestId` UUID.
3. **Read the Result:**
   - `4xx` (`statusCode` 400–499): Validation, authentication, or business conflict (e.g., `PRODUCT_UNAVAILABLE`, `IDEMPOTENCY_KEY_REUSED`).
   - `5xx` (`statusCode` 500–599): Server exception or database connection failure.
   - `durationMs`: High latency points to slow queries or lock contention.
   - *Redaction Guarantee:* Request bodies, passwords, cookies, and `Authorization` headers are never logged.
4. **Verify Health Probes:** Check `/health/live` (Node process) and `/health/ready` (PostgreSQL `SELECT 1`).

---

## 2. Database Migration Execution & Failure Recovery (P9-14)

### Standard Production Migration Rules
- **NEVER** run `npx prisma migrate dev` or `npx prisma migrate reset` against production.
- **ALWAYS** take a backup first using [scripts/backups.sh](../scripts/backups.sh):
  ```bash
  DATABASE_URL="<external_prod_url>" ./scripts/backups.sh
  ```
- **ALWAYS** apply committed migrations in production using:
  ```bash
  npx prisma migrate deploy
  ```

### Recovering from a Failed Migration
PostgreSQL executes each migration inside a transaction. If it fails partway, the SQL rolls back, and Prisma records the migration as failed in `_prisma_migrations` to prevent unsafe follow-up deploys.

1. **Check Status:**
   ```bash
   npx prisma migrate status
   ```
2. **Fix the Root Cause:** Resolve conflicting production data, permissions, or connection timeouts.
3. **Mark Migration Outcome:**
   - If the failed migration **rolled back** and was NOT applied:
     ```bash
     npx prisma migrate resolve --rolled-back "<migration_folder_name>"
     npx prisma migrate deploy
     ```
   - If you **manually applied** the SQL fix to production:
     ```bash
     npx prisma migrate resolve --applied "<migration_folder_name>"
     ```
4. **Disaster Fallback:** Restore the pre-migration dump into an isolated environment first via [scripts/restore.sh](../scripts/restore.sh) to confirm integrity before cutting over.

---

## 3. Backup & Recovery Drill Checklist (P9-13)

1. **Simulate DB Unavailability:** Stop local Postgres or point to an unreachable DB port $\rightarrow$ confirm `GET /health/live` returns `200 OK` and `GET /health/ready` returns `503 Service Unavailable`.
2. **Create Backup:** Run `./scripts/backups.sh` to produce a compressed `.dump` file in `./backups/`.
3. **Isolated Restore:** Restore into a non-production database (`retailflow_test`) using `./scripts/restore.sh <dump_file> <target_url>`.
4. **Verify Records:** Confirm row counts and run integration smoke tests against the restored environment.
