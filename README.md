# Botwa

Backend y web del CRM multi-Negocio de WhatsApp descrito en [`docs/PLAN.md`](docs/PLAN.md).

## Estado de implementación

Fases 1–8 implementadas en código con adaptadores mockeados para Meta, Resend y LLM. Las validaciones reales contra esos servicios externos permanecen bloqueadas hasta disponer de credenciales; ver `docs/RUNBOOKS.md` y la nota final de este README.

| Fase | Alcance | Estado local |
|---|---|---|
| 0 | Repo, Docker, Fastify, Prisma | ✅ verificado |
| 1 | Magic link, sesión cookie, RBAC, multi-Negocio | ✅ |
| 2 | Wizard de número, webhooks duraderos, media | ✅ |
| 3 | Bandeja, asignación atómica, WebSocket, lecturas | ✅ |
| 4 | Envío con reintentos, estados Meta, uploads firmados | ✅ |
| 5 | Bot KEYWORD/REGEX con escalación | ✅ |
| 6 | LLM mock con `Decimal`, costo y tope | ✅ |
| 7 | Métricas de agentes y dashboard accesible | ✅ |
| 8 | Imagen Docker, runbooks, script de backup, `docker compose` con api/worker | ✅ |

## Requisitos

- Node.js 22
- Docker con Compose
- PostgreSQL 16, Redis 7 y MinIO (se levantan con Compose)

## Arranque local

```bash
cp .env.example .env
docker compose up -d postgres redis minio minio-init
npm install
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
npm run dev          # API
npm run dev:worker   # Worker de BullMQ
```

En otra terminal:

```bash
npm run web:dev      # Vite en http://localhost:5173
```

## Verificación

```bash
npm test             # Vitest (unit, webhook, bot/LLM)
npm run typecheck    # TypeScript del backend
npm run web:typecheck
npm run build
npm run web:build
npm run prisma:validate
docker compose config --quiet
npm run audit        # Dependencias del backend
```

## Variables de entorno

Ver `.env.example`. El archivo `.env` está ignorado. Los secretos globales se inyectan desde el proveedor de despliegue. En producción sin `RESEND_API_KEY` el proceso falla de inmediato para no aceptar enlaces rotos.

## Endpoints clave

| Método | Ruta | Permiso | Función |
|---|---|---|---|
| `POST` | `/v1/auth/magic` | público | Solicitar magic link |
| `GET` | `/v1/auth/callback` | público | Consumir el enlace y crear sesión cookie |
| `POST` | `/v1/auth/logout` | sesión | Revocar sesión |
| `GET` | `/v1/auth/session` | sesión | Devolver el usuario actual |
| `GET/POST/PATCH` | `/v1/businesses[/:id]` | `config.*` | CRUD de Negocio |
| `POST` | `/v1/businesses/:id/phone-number/start` | `config.edit` | Iniciar wizard |
| `POST` | `/v1/businesses/:id/phone-number/verify` | `config.edit` | Confirmar código |
| `GET` | `/v1/businesses/:id/phone-number` | `config.view` | Ver número |
| `GET/POST/PATCH/DELETE` | `/v1/businesses/:id/bot-rules` | `bots.*` | CRUD del bot |
| `GET/POST` | `/v1/businesses/:id/llm-config` | `config.*` | Configuración LLM del Negocio |
| `GET` | `/v1/businesses/:id/llm-usage` | `metrics.view` | Costos de LLM |
| `GET` | `/v1/businesses/:id/conversations` | `chats.view` | Bandeja con cursor |
| `GET` | `/v1/conversations/:id/messages` | `chats.view` | Historial con cursor |
| `POST` | `/v1/conversations/:id/messages` | `chats.respond` | Enviar (texto/imagen/documento) |
| `POST` | `/v1/conversations/:id/assign` | `chats.assign` | Asignar o devolver al pool |
| `POST` | `/v1/conversations/:id/resolve` | `chats.assign` | Resolver |
| `POST` | `/v1/conversations/:id/read` | `chats.view` | Marcar leído por usuario |
| `POST` | `/v1/businesses/:id/uploads` | `chats.respond` | URL prefirmada para adjuntos |
| `GET` | `/v1/businesses/:id/metrics/summary` | `metrics.view` | Resumen |
| `GET` | `/v1/realtime` | sesión | WebSocket autenticado por Negocio |
| `GET/POST` | `/webhook` | público | Verificación y entrega de Meta |
| `GET/POST` | `/v1/businesses/:id/members` | `users.*` | Invitar y listar miembros |

## Decisiones de diseño

- **Multi-Negocio real**: cada consulta por Negocio se acota explícitamente; un recurso de otro tenant devuelve 404, no 403.
- **Una sola cookie de sesión**: tokens aleatorios, persistidos como hash SHA-256 y revocables. CSRF por token doble + verificación de origen en mutaciones.
- **Webhook durable**: `WebhookEvent` se guarda antes de encolar; un barrido cada 2 minutos reencola eventos con lease vencido o sin procesar, así la pérdida de Redis no implica pérdida de mensajes.
- **Verificación de firma**: HMAC SHA-256 sobre los bytes crudos de la solicitud, con `timingSafeEqual`.
- **Idempotencia**: `waMessageId` y `clientMsgId` son únicos; los duplicados devuelven el mismo registro.
- **Tokens de Meta**: una sola credencial global inyectada al despliegue. No se cifran ni almacenan por Negocio en esta versión.
- **Costos LLM**: `Prisma.Decimal` evita flotantes; el tope se verifica en cada llamada.
- **Frontend**: React + Vite + React Router 5 + TanStack Query + CSS propio, accesible y con plantillas equivalentes para personas que usan lector de pantalla.

## Lo que aún no se valida con credenciales reales

- Onboarding y verificación del número con Meta.
- Entrega real de webhooks a través de HTTPS público.
- Expiración real de la URL de media de Meta.
- Entregabilidad de Resend y verificación del dominio.
- CORS y ciclo de vida del objeto en Cloudflare R2.
- Comportamiento real de un proveedor LLM y sus contadores de tokens.
- Restauración real desde un bucket de backups en producción.

La aplicación corre completamente en local con Postgres, Redis y MinIO. Para validar el resto, sigue `docs/RUNBOOKS.md` y crea la cuenta en cada proveedor.
