#!/usr/bin/env bash
set -euo pipefail

if [ -z "${1:-}" ] || [ -z "${2:-}" ]; then
  echo "Usage: ./scripts/restore.sh <path_to_dump_file> <target_database_url>"
  exit 1
fi

BACKUP_FILE="$1"
TARGET_URL="$2"

# Safety guard: Refuse accidental overwrite of production URLs without explicit confirmation
if [[ "$TARGET_URL" == *"prod"* ]]; then
  echo "⚠️ WARNING: Target database URL contains 'prod'. Type 'YES' to confirm:"
  read -r CONFIRM
  if [ "$CONFIRM" != "YES" ]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "Restoring $BACKUP_FILE into target database..."
pg_restore --clean --if-exists --no-owner --no-privileges -d "$TARGET_URL" "$BACKUP_FILE"
echo "✅ Restore completed successfully."