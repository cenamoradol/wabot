# Runbooks

## Cola de Redis caída y recuperación de webhooks

1. **Detectar**: `/health/ready` devuelve 503 para la API; los trabajos no avanzan.
2. **Impacto**: las llamadas a Meta siguen registradas en `WebhookEvent` con `processedAt: null`.
3. **Recuperación**: reanudar Redis, luego `npm run start:worker` (BullMQ ejecuta el planificador `recover-webhooks` cada 2 minutos).
4. **Verificar**: `WebhookEvent` con `processedAt: null` debe reducirse a cero; `messages_inbound_total` debe crecer para cada Negocio.

## Eventos de webhook atascados

1. **Síntoma**: un `WebhookEvent` tiene `attemptCount` alto y `lastError` poblado.
2. **Inspeccionar**: `SELECT id, fingerprint, attempt_count, last_error FROM "WebhookEvent" WHERE processed_at IS NULL ORDER BY received_at;`
3. **Resolver**: corregir la causa subyacente (Meta inestable, base de datos), luego `psql -c "UPDATE \"WebhookEvent\" SET next_attempt_at = NOW(), processing_started_at = NULL WHERE id = '<id>';"`.
4. **Forzar**: el `start:worker` re-encolará en el próximo ciclo o puede encolarse manualmente: `redis-cli RPUSH bull:webhook-events:wait LIST <payload>`.

## Rotación del token global de Meta

1. Rotar la clave de acceso en Meta Business → Usuarios del sistema.
2. Actualizar el secreto del despliegue (Doppler/Vault, no commit).
3. Reiniciar API y workers. La verificación del webhook y los envíos usan el token global.
4. Verificar el envío saliente de prueba contra un Negocio.

## Calidad degradada del número

1. La tarea `recover-webhooks` actualiza `qualityRating` desde la respuesta de Meta (futuro).
2. Mientras tanto, abrir la API y `SELECT * FROM "PhoneNumber" WHERE status = 'ACTIVE' AND quality_rating = 'RED';` y avisar al dueño.

## Falla de descarga de media

1. Revisar `Message.mediaError` para el error de Meta.
2. Si el token Meta expiró, rotar (runbook anterior) y reencolar: `psql -c "UPDATE \"Message\" SET media_local_key = NULL, media_error = NULL WHERE media_error IS NOT NULL;"`.
3. `start:worker` reencolará el trabajo de descarga.

## Tope mensual de LLM alcanzado

1. `LlmConfig.monthlyCapUsd` se evalúa en cada llamada; las reglas LLM deben estar deshabilitadas por el Dueño.
2. Verificar con `GET /v1/businesses/<id>/llm-config`.
3. Reseteo manual: incrementar el cap y reactivar reglas; los cargos previos no se modifican.

## Restauración de base de datos

1. `pg_dump --no-owner $DATABASE_URL > backup.sql` se ejecuta automáticamente y se sube al bucket de backups.
2. Restaurar: `createdb botwa && psql botwa < backup.sql` seguido de `npm run prisma:deploy` para aplicar migraciones que falten.
3. Verificar conteos: `psql -c "SELECT (SELECT COUNT(*) FROM \"Business\"), (SELECT COUNT(*) FROM \"Message\"), (SELECT COUNT(*) FROM \"WebhookEvent\");"` contra las métricas esperadas.
4. Si la restauración es desde R2, los objetos multimedia se obtienen directamente; sin pérdida.

## Rollback de imagen

1. `docker compose pull` la etiqueta previa.
2. `npm run prisma:deploy` solo si la migración previa es compatible con el esquema actual. Si no, restaurar también la base.
3. Reiniciar `api` y `worker` con el manifiesto previo.
