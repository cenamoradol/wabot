# reset-db.ps1 — BORRA los volúmenes persistentes y deja la base vacía con un súper-admin.
# PELIGRO: ejecuta `docker compose down -v`. No usar si hay datos que quieras conservar.
param([switch]$Force)

if (-not $Force) {
  $answer = Read-Host "Esto borrará los volúmenes de Postgres/Redis/MinIO. ¿Continuar? (sí/no)"
  if ($answer -notin @("sí", "si", "s", "yes", "y")) { Write-Host "Cancelado"; exit 0 }
}

docker compose down -v
docker compose up -d postgres redis minio minio-init
npm run prisma:migrate
npm run prisma:seed
Write-Host "Listo. Súper-admin: $($env:SUPERADMIN_EMAIL)"
