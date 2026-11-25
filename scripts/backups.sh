#!/usr/bin/env bash
set -euo pipefail

# Require DATABASE_URL to be set
if [ -z "${DATABASE_URL:-}" ]; then
  echo "❌ ERROR: DATABASE_URL is not set."
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="./backups"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/retailflow_${TIMESTAMP}.dump"

echo "Starting compressed PostgreSQL backup to $BACKUP_FILE..."
pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL" > "$BACKUP_FILE"
echo "✅ Backup completed: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"