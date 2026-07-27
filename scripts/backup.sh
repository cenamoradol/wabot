#!/usr/bin/env bash
# Sincroniza el dump de PostgreSQL con un bucket compatible con S3.
# Variables esperadas: DATABASE_URL, BACKUP_S3_BUCKET, BACKUP_S3_PREFIX, BACKUP_S3_ENDPOINT,
# BACKUP_S3_ACCESS_KEY, BACKUP_S3_SECRET_KEY, BACKUP_RETENTION_DAYS (opcional, por defecto 30).

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET is required}"
: "${BACKUP_S3_PREFIX:=backups/postgres}"
: "${BACKUP_S3_ENDPOINT:?BACKUP_S3_ENDPOINT is required}"
: "${BACKUP_S3_ACCESS_KEY:?BACKUP_S3_ACCESS_KEY is required}"
: "${BACKUP_S3_SECRET_KEY:?BACKUP_S3_SECRET_KEY is required}"
: "${BACKUP_RETENTION_DAYS:=30}"

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
file="/tmp/botwa-${timestamp}.sql.gz"
pg_dump --no-owner --format=plain "$DATABASE_URL" | gzip > "$file"

export AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY"
export AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY"
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$file" "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/$(basename "$file")"
rm -f "$file"

cutoff=$(date -u -d "$BACKUP_RETENTION_DAYS days ago" +%Y%m%dT%H%M%SZ)
aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 ls "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/" \
  | awk '{print $4}' \
  | while read -r key; do
      [ -z "$key" ] && continue
      name=$(basename "$key" .sql.gz)
      suffix=${name#botwa-}
      if [[ "$suffix" < "$cutoff" ]]; then
        aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 rm "s3://$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/$key"
      fi
    done
