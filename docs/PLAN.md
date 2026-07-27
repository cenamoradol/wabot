# PLAN — CRM de WhatsApp multi-Negocio (API oficial de Meta)

## 1. Contexto y objetivos

CRM SaaS donde cada **Negocio** (inquilino) opera sobre un número de WhatsApp Business conectado vía la Cloud API oficial de Meta. Funcionalidad núcleo:

- **Recibir** mensajes entrantes y mostrarlos en una bandeja por Agente.
- **Responder** mensajes (texto, imagen, documento, audio).
- **Bot** que responde automáticamente con reglas (palabra clave, regex) y, cuando no hay match, con un modelo de lenguaje (LLM). Escala a humanos cuando no puede resolver.
- **Métricas** de los Agentes: volumen atendido, tiempo de primera respuesta, tiempo de resolución, porcentaje resueltas por bot, costo de LLM.

Fuera de alcance en esta versión: plantillas de Meta, envío masivo, campañas, catálogos de productos, multi-canal, llamadas de voz.

## 2. Glosario

| Término | Significado en español |
|---|---|
| Cuenta de WhatsApp (en Meta) | Donde se registran los números. La del dueño del CRM contiene todos los números de todos los Negocios. |
| Identificador del número | Código único que Meta le asigna a cada número. Tu backend lo usa para "mandá con el número X". |
| Token de acceso | Llave permanente que Meta te da para llamar a sus servidores. Se genera una vez y se usa siempre. |
| App de Meta | Aplicación registrada en `developers.facebook.com` que identifica a tu CRM ante Meta. |
| Negocio | Un cliente/inquilino del CRM. Tiene un número propio, un Dueño, sus Agentes y sus conversaciones. |
| Workspace | Sinónimo histórico de Negocio. Se elimina en código y UI en favor de "Negocio". |
| R2 | Servicio de almacenamiento de objetos de Cloudflare, compatible con la API de S3 pero sin cargo de salida. |
| Webhook | Endpoint HTTPS público que Meta llama cuando hay mensajes nuevos. |
| Open / Asignada / Resuelta | Estados posibles de una conversación dentro del CRM. |

## 3. Stack

| Capa | Elección | Motivo |
|---|---|---|
| Lenguaje | TypeScript sobre Node 22 LTS | Pedido del proyecto |
| HTTP | Fastify | Rápido, validación con Zod, schema-first, poca ceremonia para 1-3 devs |
| ORM | Prisma | Migraciones, tipos generados, comunidad |
| Cola | BullMQ sobre Redis | Estándar en Node, retries, dashboard |
| Base de datos | Postgres 16 | JSONB para payloads crudos, FTS para búsqueda en bandeja |
| Cache y pub/sub | Redis 7 | BullMQ + cache de tokens + notificaciones en tiempo real |
| Almacenamiento | Cloudflare R2 | S3-compatible sin cargo de salida; misma SDK cambiando endpoint |
| Auth | Magic link con Resend, o Clerk | Sin contraseñas propias |
| Observabilidad | pino y OpenTelemetry | Logs estructurados y tracing |
| Despliegue | Docker, en Fly.io o Railway al inicio | Simple, escala horizontal después si hace falta |
| Pruebas | Vitest, Playwright, k6, Artillery | Ver sección 19 |

## 4. Modelo de datos

Esquema Prisma resumido. Las migraciones se versionan en `prisma/migrations`.

```prisma
model Business {
  id            String   @id @default(cuid())
  name          String
  createdAt     DateTime @default(now())
  members       BusinessMember[]
  phoneNumbers  PhoneNumber[]
  contacts      Contact[]
  conversations Conversation[]
  botRules      BotRule[]
  roleTemplates RoleTemplate[]
  llmConfig     LlmConfig?
  llmUsage      LlmUsage[]
}

model User {
  id           String  @id @default(cuid())
  email        String  @unique
  name         String?
  memberships  BusinessMember[]
}

model BusinessMember {
  userId             String
  businessId         String
  roleTemplateId     String?
  customPermissions  Json?
  user               User     @relation(fields: [userId], references: [id])
  business           Business @relation(fields: [businessId], references: [id])
  roleTemplate       RoleTemplate? @relation(fields: [roleTemplateId], references: [id])
  @@id([userId, businessId])
}

model PhoneNumber {
  id                    String   @id @default(cuid())
  businessId            String
  phoneNumberId         String   @unique
  displayPhone          String
  displayName           String
  displayNameStatus     String   @default("PENDING")
  qualityRating         String?  @default("UNKNOWN")
  accessTokenCiphertext Bytes
  verifiedAt            DateTime?
  business              Business @relation(fields: [businessId], references: [id])
}

model Contact {
  id           String  @id @default(cuid())
  businessId   String
  waId         String
  name         String?
  profilePicUrl String?
  business     Business @relation(fields: [businessId], references: [id])
  conversations Conversation[]
  @@unique([businessId, waId])
}

model Conversation {
  id              String   @id @default(cuid())
  businessId      String
  contactId       String
  assignedUserId  String?
  status          String   @default("OPEN")
  botHandled      Boolean  @default(false)
  firstResponseAt DateTime?
  resolvedAt      DateTime?
  lastMessageAt   DateTime @default(now())
  business        Business @relation(fields: [businessId], references: [id])
  contact         Contact  @relation(fields: [contactId], references: [id])
  messages        Message[]
  @@index([businessId, lastMessageAt(sort: Desc)])
  @@index([businessId, status])
}

model Message {
  id             String   @id @default(cuid())
  conversationId String
  clientMsgId    String?
  waMessageId    String?
  direction      String
  authorType     String
  authorUserId   String?
  type           String
  body           String?
  mediaLocalKey  String?
  status         String   @default("SENT")
  timestamp      DateTime
  rawPayload     Json
  conversation   Conversation @relation(fields: [conversationId], references: [id])
  @@index([conversationId, timestamp])
  @@index([clientMsgId])
}

model BotRule {
  id                     String  @id @default(cuid())
  businessId             String
  name                   String
  matchType              String  // KEYWORD | REGEX | AI
  pattern                String?
  priority               Int     @default(100)
  enabled                Boolean @default(true)
  responseType           String  // TEXT | LLM
  response               String?
  systemPrompt           String?
  temperature            Float?
  maxTokens              Int?
  escalateAfterAttempts  Int?
  business               Business @relation(fields: [businessId], references: [id])
  @@index([businessId, priority])
}

model LlmConfig {
  businessId                      String  @id
  provider                        String  // openai | anthropic | minimax | custom
  model                           String
  apiKeyCiphertext                Bytes
  apiBase                         String?
  temperature                     Float   @default(0.7)
  maxTokens                       Int     @default(500)
  costPerMillionPromptTokens      Float
  costPerMillionCompletionTokens   Float
  monthlyCapUsd                   Float   @default(10)
  business                        Business @relation(fields: [businessId], references: [id])
}

model LlmUsage {
  id               String   @id @default(cuid())
  businessId       String
  conversationId   String?
  provider         String
  model            String
  promptTokens     Int
  completionTokens Int
  costUsd          Float
  at               DateTime @default(now())
  business         Business @relation(fields: [businessId], references: [id])
  @@index([businessId, at])
}

model RoleTemplate {
  id          String  @id @default(cuid())
  businessId  String?
  name        String
  isDefault   Boolean @default(false)
  permissions Json
  business    Business? @relation(fields: [businessId], references: [id])
  members     BusinessMember[]
}

model WebhookEvent {
  id            String   @id @default(cuid())
  phoneNumberId String
  type          String
  payload       Json
  receivedAt    DateTime @default(now())
  processedAt   DateTime?
  @@index([phoneNumberId, receivedAt(sort: Desc)])
}

model AuditEvent {
  id          String   @id @default(cuid())
  businessId  String?
  userId      String?
  type        String
  payload     Json
  at          DateTime @default(now())
  @@index([businessId, at])
}
```

Plantillas de rol predeterminadas (sembradas en la primera migración):

- **Dueño**: todo permitido en todos los módulos.
- **Administrador**: todo excepto `config.edit`.
- **Agente**: solo `chats.view` y `chats.respond`.
- **Analista**: solo `metrics.view`.

`permissions` es JSON con la forma:

```json
{
  "modules": {
    "chats":   { "view": true,  "respond": true,  "assign": false },
    "metrics": { "view": true },
    "bots":    { "view": true,  "create": true,  "edit": true, "delete": false },
    "users":   { "view": true,  "create": true,  "edit": true, "delete": false },
    "config":  { "view": true,  "edit": false }
  }
}
```

## 5. Conexión del número de cada Negocio

Wizard de 3 pasos en la UI:

1. **Datos del Negocio** — nombre comercial, categoría, número con código de país.
2. **Verificación** — Meta envía un código por SMS o llamada al número; el usuario lo ingresa.
3. **Confirmación** — número activo, Meta revisa el nombre comercial (1-48 h, el sistema notifica al Dueño cuando aprueba).

### Lo que necesita el dueño del Negocio

- Celular con número propio que pueda recibir SMS o llamada.
- El número NO debe estar ya registrado en WhatsApp ni en WhatsApp Business app.
- Nombre comercial real (Meta revisa que el nombre corresponda al negocio).

### Lo que NO necesita

- Descargar apps.
- Tener cuenta de Facebook personal.
- Hablar con Meta.
- Entregar contraseñas.

### Regla crítica sobre números VoIP

Meta rechaza números VoIP puros (Twilio Voice, Google Voice, líneas IP de oficina). El número tiene que ser un número móvil real que pueda recibir SMS. Esto aplica tanto para números del cliente como para los que vos (dueño del CRM) quieras comprar.

### Lo que el dueño del CRM hace una sola vez

Verificación de empresa en Meta Business (identificación oficial, comprobante de domicilio, sitio web con dominio verificado, teléfono de contacto). Trámite gratuito, Meta revisa en horas o hasta 5 días hábiles.

## 6. LLM agnóstico

### Interfaz

```ts
interface LLMProvider {
  readonly name: string;
  chat(req: {
    systemPrompt: string;
    messages: { role: "user" | "assistant"; content: string }[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{
    reply: string;
    usage: { promptTokens: number; completionTokens: number };
  }>;
}
```

### Implementaciones

Una clase por proveedor, archivo de unas 50 líneas cada una:

- `OpenAIProvider` — API estándar de OpenAI.
- `AnthropicProvider` — Messages API de Anthropic.
- `MinimaxProvider` — API de MiniMax.
- `CustomProvider` — base URL configurable (Ollama local, OpenRouter, cualquier API compatible con OpenAI).

Agregar un proveedor nuevo es crear un archivo. El resto del sistema no se entera.

### Configuración por Negocio (cifrada)

Campos en `LlmConfig`:

- `provider` (openai, anthropic, minimax, custom).
- `model` (string libre).
- `apiKeyCiphertext` (cifrado con KMS).
- `apiBase` opcional, solo para `custom`.
- `temperature`, `maxTokens`.
- `costPerMillionPromptTokens`, `costPerMillionCompletionTokens`.
- `monthlyCapUsd` (tope mensual).

### Tracking de costo

Cada llamada al LLM se persiste en `LlmUsage` con tokens y costo. Permite:

- Mostrar al dueño del CRM cuánto consume cada Negocio.
- Cobrar margen.
- Detectar reglas que están quemando plata.
- Cortar el bot si se supera el `monthlyCapUsd` del Negocio.

## 7. Bot: reglas → LLM → escalación

### Pipeline de un mensaje entrante

1. Cargar reglas del Negocio ordenadas por `priority` ascendente.
2. Para cada regla habilitada, evaluar:
   - `KEYWORD`: contains case-insensitive sobre el cuerpo.
   - `REGEX`: match completo con el patrón.
   - `AI`: siempre true (van al final porque cuestan).
3. Primera regla que matchea:
   - `responseType = TEXT` → enviar texto fijo, incrementar contador de intentos.
   - `responseType = LLM` → llamar al provider configurado con `systemPrompt` más los últimos N mensajes (10 a 20) de la conversación, enviar la respuesta.
4. Si ninguna matchea:
   - Si hay regla `AI`, usarla.
   - Si no, escalar a humano.
5. Post-respuesta:
   - Si `attempts >= escalateAfterAttempts`, marcar la conversación como `OPEN` sin asignar (cae al pool de Agentes).
   - Si no, dejar `botHandled = true` y seguir en modo bot.

### Ventana de contexto del LLM

Nunca se manda toda la conversación al modelo. Se eligen los últimos 10-20 mensajes y un `systemPrompt` con:

- Personalidad del Negocio.
- Reglas duras (no inventar precios, si preguntan por X responder Y).
- Datos estructurados opcionales (horarios, ubicación, catálogo chico).

### Escalaciones automáticas

Se escala a humano siempre que:

- El cliente pide hablar con una persona (palabras clave configurables por Negocio).
- `attempts` supera el límite de la regla.
- El LLM marca su respuesta como "no sé".
- El mensaje contiene palabras sensibles configuradas (queja, reclamo, abogado, etc.).

## 8. Métricas de Agentes

Consultas SQL sobre `conversations`, `messages`, `business_members`. No se llama a Meta para nada de esto.

### Métricas principales

- **Volumen por Agente**: conversaciones asignadas en una ventana de tiempo.
- **Tiempo medio de primera respuesta (FRT)** por Agente.
- **Tiempo medio de resolución** por Agente.
- **Cola actual**: conversaciones `OPEN` y `ASSIGNED`, con tiempo desde el último mensaje del cliente.
- **Porcentaje resueltas por bot** sin intervención humana.
- **Costo de LLM** por Negocio y por regla del bot.

### Dashboard mínimo

- 4 tarjetas: conversaciones abiertas, sin asignar, asignadas hace más de 5 minutos, resueltas hoy.
- 2 gráficos: FRT mediano por Agente, volumen por Agente.
- 1 medidor: porcentaje resueltas por bot.
- 1 tabla: consumo y costo de LLM por Negocio.

## 9. API HTTP (Fastify)

| Método | Ruta | Permiso | Función |
|---|---|---|---|
| `POST` | `/v1/auth/magic` | público | Solicitar magic link |
| `GET` | `/v1/auth/callback` | público | Consumir magic link y devolver JWT |
| `GET` | `/v1/businesses` | usuario | Listar Negocios del usuario |
| `POST` | `/v1/businesses` | usuario | Crear Negocio (queda como Dueño) |
| `GET` | `/v1/businesses/:id` | `config.view` | Ver Negocio |
| `PATCH` | `/v1/businesses/:id` | `config.edit` | Editar Negocio |
| `POST` | `/v1/businesses/:id/phone-numbers/start` | `config.edit` | Iniciar wizard de conexión |
| `POST` | `/v1/businesses/:id/phone-numbers/verify` | `config.edit` | Confirmar código de Meta |
| `GET` | `/v1/businesses/:id/phone-numbers` | `config.view` | Ver números y su calidad |
| `GET` | `/v1/businesses/:id/conversations` | `chats.view` | Bandeja con filtros |
| `GET` | `/v1/conversations/:id/messages` | `chats.view` | Historial paginado |
| `POST` | `/v1/conversations/:id/messages` | `chats.respond` | Enviar texto o media |
| `POST` | `/v1/conversations/:id/assign` | `chats.assign` | Asignar a Agente o devolver al bot |
| `POST` | `/v1/conversations/:id/resolve` | `chats.assign` | Marcar resuelta |
| `POST` | `/v1/conversations/:id/read` | `chats.view` | Marcar leído y notificar a Meta |
| `GET` | `/v1/businesses/:id/metrics/agents` | `metrics.view` | Métricas de Agentes |
| `GET/POST/PATCH/DELETE` | `/v1/businesses/:id/bot-rules` | `bots.*` | CRUD del bot |
| `GET/POST/PATCH` | `/v1/businesses/:id/llm-config` | `config.edit` | Configuración LLM del Negocio |
| `GET` | `/v1/businesses/:id/llm-usage` | `metrics.view` | Costos de LLM |
| `GET/POST` | `/v1/businesses/:id/members` | `users.view` | Listar e invitar usuarios |
| `PATCH/DELETE` | `/v1/businesses/:id/members/:userId` | `users.edit` / `users.delete` | Cambiar permisos, expulsar |
| `GET/POST/PATCH/DELETE` | `/v1/businesses/:id/role-templates` | `users.edit` | Plantillas de rol del Negocio |
| `GET/POST` | `/webhook` | público | Verificación y eventos de Meta |

## 10. Webhook y mensajes en tiempo real

### Endpoint

- `GET /webhook`: verificación inicial con `hub.mode`, `hub.verify_token`, `hub.challenge`.
- `POST /webhook`: recibe eventos. Validar firma `X-Hub-Signature-256` con tu `appSecret` antes de parsear nada. Si la firma falla, responder 401 y guardar en `AuditEvent`.

### Flujo del mensaje entrante

1. Verificar firma. Si falla, 401.
2. Insertar evento en `WebhookEvent` (append-only, payload crudo).
3. Encolar `process-webhook-event` con `{ phoneNumberId, change }`.
4. Responder 200 inmediato (Meta exige menos de 5 segundos).
5. Worker procesa: resolver Negocio por `phoneNumberId`, upsert Contact, crear o actualizar Conversation, insertar Message, encolar descarga de media si hay adjuntos, publicar en Redis pub/sub el canal `business:{id}`.

### Tiempo real para la UI

- Frontend abre WebSocket autenticado contra el backend al cargar la bandeja.
- Backend suscribe ese socket al canal de Redis `business:{id}` del usuario.
- Cuando llega un mensaje, el worker publica; el servidor lo emite por el socket; el cliente agrega la burbuja al chat y dispara una notificación suave.
- Latencia esperada de extremo a extremo: 2 a 6 segundos entre que el cliente aprieta enviar y el Agente ve la burbuja.
- Heartbeat cada 30 segundos por socket para mantener viva la conexión. Al reconectar, el cliente pide los mensajes perdidos desde su `lastMessageId` conocido.
- Si el worker o Redis están caídos, el mensaje igual queda en la base de datos y aparece cuando el cliente vuelva a abrir la bandeja.

### Multi-pestaña, multi-Agente

- Si hay varios Agentes con la bandeja abierta y la conversación está `OPEN`, todos reciben el push. El primero que la abre la marca como asignada y los demás la dejan de ver en su bandeja activa.
- Si dos pestañas del mismo Agente tienen la misma conversación abierta, ambas reciben el push; la que responda primero sincroniza a la otra con el `status` del mensaje.

## 11. Workers (BullMQ)

Colas y trabajos:

- `process-webhook-event` — procesar mensajes entrantes.
- `download-media` — descargar media de Meta antes de que expire la URL (SLA menos de 2 minutos, persistente).
- `send-message` — envío con retry exponencial en errores 5xx y 429.
- `sync-message-status` — actualizar estado `sent → delivered → read` desde webhooks de Meta.
- `send-llm-and-respond` — usado por el bot cuando una regla es LLM, registra tokens y costo.
- `enforce-llm-cap` — diario, deshabilita reglas LLM de Negocios que superaron su `monthlyCapUsd`.
- `lost-messages-sweep` — cada 2 minutos, para Negocios activos, pregunta a Meta por mensajes que pudieron haberse perdido entre el último webhook y `ahora`.

## 12. Seguridad

- **Cifrado en reposo**: tokens de Meta y API keys de LLM con AES-256-GCM, llave maestra en KMS, nunca en variables de entorno planas.
- **Firma de webhooks**: validar siempre `X-Hub-Signature-256` antes de parsear.
- **Anti-CSRF en wizard**: `state` firmado con JWT, expiración de 10 minutos, guardado en cookie HttpOnly.
- **Aislamiento por Negocio**: middleware que inyecta el filtro `businessId` en todas las queries Prisma. Cross-tenant debe devolver 404, no 403, para no filtrar existencia.
- **Rate limit por Negocio**: token bucket en Redis para evitar que un Agente con un loop queme la calidad del número.
- **Audit log**: tabla `AuditEvent` para envíos, altas, bajas, cambios de permisos, login.
- **Backups**: volcado diario de Postgres, retención 30 días, almacenado en R2.
- **Secretos**: Doppler o Vault, nunca en el repo.
- **Magic link**: token de un solo uso, expiración 15 minutos.

## 13. Observabilidad

- **Logs**: pino estructurado con `businessId`, `phoneNumberId`, `conversationId`, `waMessageId`.
- **Tracing**: OpenTelemetry, muestreo 10 por ciento en tráfico normal, 100 por ciento en errores.
- **Métricas Prometheus clave**:
  - `webhook_latency_seconds` (p50, p95, p99).
  - `webhook_signature_failures_total`.
  - `messages_inbound_total{businessId}`.
  - `messages_outbound_total{businessId, status}`.
  - `llm_tokens_total{businessId, provider, model}`.
  - `llm_cost_usd_total{businessId}`.
  - `media_download_failures_total`.
  - `queue_depth{queue}`.
- **Alertas**: p95 de webhook por encima de 2 segundos, firmas fallando más de 5 por minuto, número en calidad `RED`, costo de LLM por Negocio en pico mensual.

## 14. Costos para el dueño del CRM

- **Conversaciones de Meta**: todas son iniciadas por el cliente, todas son categoría "service". Meta cobra 0 las primeras 1000 por mes por número. Después de eso, la tarifa la define Meta por país. Este plan no requiere tracking de billing Meta en v1.
- **LLM**: a vos te cobran los tokens consumidos. Se los pasás al cliente con margen, o los absorbés como costo del servicio.
- **Infra** para 50 Negocios con 100 mensajes por día cada uno, orden de magnitud: 30 a 80 USD por mes (Postgres chico, Redis chico, R2 chico, un contenedor).

## 15. Roadmap por fases

| Fase | Alcance | Semanas |
|---|---|---|
| **0** | Repo, docker-compose con Postgres, Redis y MinIO local, Fastify, Prisma, deploy, variables de entorno con token de Meta y credenciales de R2 | 0.5 |
| **1** | Auth con magic link, modelo de datos, seed de plantillas de rol, sistema de permisos modular | 1 |
| **2** | Alta de Negocio, wizard de conexión del número, webhook entrando, persistencia, descarga de media a R2 | 2 |
| **3** | Bandeja con WebSocket, asignar conversación, marcar leído, cerrar | 1.5 |
| **4** | Responder (texto, imagen, documento), escuchar status updates de Meta | 1 |
| **5** | Bot con reglas (KEYWORD, REGEX) y escalación a humanos | 1.5 |
| **6** | Bot con LLM agnóstico, ventana de contexto, tracking de costo, tope mensual | 1.5 |
| **7** | Métricas de Agentes con queries y dashboard | 1.5 |
| **8** | Hardening: load test, tracing, alertas, runbooks, backups verificados | 1 |

**Total estimado**: 11 a 12 semanas para un MVP en producción.

## 16. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Meta rechaza el nombre comercial de un Negocio | La UI avisa que puede tardar 1 a 48 horas. Durante ese tiempo el número no puede iniciar conversaciones business-initiated, lo cual no afecta este producto. |
| Verificación de empresa del dueño del CRM tarda | Arrancar el código en paralelo. No bloquea. |
| Latencia del webhook | Procesamiento async, 200 inmediato, BullMQ absorbe picos. |
| Meta cambia la API | Versionado en la URL (`v21.0`), tests de contrato con cassettes grabados. |
| Token de acceso de Meta comprometido | Rotación manual desde Meta, llave en KMS. |
| Cliente inunda mensajes | Rate limit por Negocio. |
| Media de Meta expira a los 5 minutos | Worker dedicado con SLA menor a 2 minutos. |
| Bot alucina u ofende a un cliente | `systemPrompt` estricto, escalación automática por palabras sensibles, revisión humana de logs. |
| Costo de LLM se dispara | Tracking por Negocio, alerta al superar umbral, corte automático al `monthlyCapUsd`. |
| Ban de tu cuenta de WhatsApp (raro, pero pasa) | Backups diarios, plan documentado de portabilidad a otra cuenta. |

## 17. Decisiones cerradas

- Multi-tenant en un solo servidor con Fastify.
- Una sola cuenta de WhatsApp del dueño del CRM, un token de acceso, N números, un identificador por Negocio.
- Cada Negocio trae su propio número (SIM física o número móvil real de un proveedor; nunca VoIP puro).
- Almacenamiento en Cloudflare R2.
- LLM agnóstico con implementaciones para OpenAI, Anthropic, MiniMax y custom.
- Roles modulares: cuatro plantillas base más permisos personalizados por usuario y plantillas propias por Negocio.
- Bot: reglas primero, LLM después, escalación a humanos al final.
- Sin plantillas de Meta, sin envío masivo, sin campañas, sin catálogos.
- Mensajes en tiempo real vía WebSocket y Redis pub/sub.

## 18. Decisiones pendientes para más adelante

- Magic link con Resend propio o Clerk.
- Hosting definitivo: Fly.io, Railway o AWS.
- Modelo de LLM por defecto para arrancar.
- Política de escalación automática (palabras sensibles por defecto).

## 19. Estrategia de testing

### Capas

1. **Unit tests con Vitest**. Funciones puras: parser de webhooks, lógica de escalación del bot, formateo de permisos, motor de la cola. Sin red, sin dependencias externas. Cobertura objetivo: 80 por ciento en lógica de Negocio.

2. **Tests de integración con el sandbox de Meta**. Webhook handler contra el número de prueba que Meta provee, envío de mensajes restringido a cinco números autorizados por Meta. CI corre estos tests.

3. **E2E con Playwright**. Wizard de alta de Negocio, invitación de Agente, primer mensaje entrando, asignación y respuesta. Las llamadas a Meta se interceptan con MSW.

4. **Staging con número real de bajo costo**. Un prepago barato dedicado a pruebas manuales. Permite validar el flujo real fuera del sandbox (aprobación de display name, calidad del número, portabilidad).

5. **Tests de aislamiento multi-tenant**. Test negativo exhaustivo: intentar leer, escribir o asignar dentro de un Negocio al que no pertenecés debe devolver 404 en todas las rutas. No 403, para no filtrar existencia.

6. **Tests del bot con LLM mockeado**. Set fijo de conversaciones sintéticas con respuesta esperada. Verifica que el pipeline KEYWORD → LLM → escalación llama al provider con los parámetros correctos, sin gastar tokens en CI.

7. **Load test con k6 o Artillery**. Simular 100 mensajes por segundo entrando al webhook durante 10 minutos. Métricas objetivo: p95 menor a 2 segundos, cero mensajes perdidos, profundidad de cola menor a 50.

### Métricas de salida para considerar "listo"

- p95 de webhook menor a 2 segundos en escenario de carga.
- 0 por ciento de mensajes perdidos en test de 10 mil mensajes inyectados.
- 100 por ciento de intentos cross-tenant bloqueados.
- 100 por ciento de las reglas de keyword matchean en su set de prueba.
- Menos de 5 por ciento de respuestas del LLM marcadas como "no sé" en el set sintético.
- Backups verificados con un演练 de restauración trimestral.

### Costos de testing

- Sandbox de Meta: gratis, cinco números permitidos.
- Staging con número real: 1 a 5 USD por número prepago, sin tráfico.
- LLMs en CI: mockeados, costo 0.
- Load test: corre en un runner propio, gratis salvo la infra.

## 20. App mobile (futuro)

No se construye en el MVP, pero el backend se diseña pensando en ella.

### Decisiones de hoy que la facilitan

- **API HTTP limpia y versionada** con JWT. La app consume la misma API que la web, sin endpoints paralelos.
- **WebSocket autenticado** ya emite mensajes por Negocio. La app se suscribe al canal y recibe el mismo push que el navegador.
- **Identificador del cliente (`clientMsgId`) en cada mensaje saliente**. Permite armar un outbox local en la app y reconciliar después de un envío offline.
- **URLs pre-firmadas de R2** para adjuntos. La app sube directo al storage sin pasar por tu backend.
- **Timestamps del servidor**, no del cliente. Sincronización correcta cuando la app vuelve de estar offline.
- **JWT de larga vida con refresh**. La app no quiere pedir login cada pocos días.

### Estimación de trabajo cuando se haga

- Backend: 0 cambios si se respetaron los puntos anteriores.
- Frontend mobile: una pantalla de bandeja (lista con WebSocket), una pantalla de chat, composer con adjuntar media, push notifications nativas vía FCM y APNs.
- Tiempo estimado: 6 a 8 semanas con una persona a tiempo completo.

### Stack probable (decisión futura)

| Opción | Pros | Contras |
|---|---|---|
| React Native y Expo | Mismo lenguaje que la web, iteración rápida | Rendimiento medio para listas largas |
| Flutter | Excelente rendimiento en listas, hot reload | Lenguaje nuevo (Dart) |
| Nativo Swift y Kotlin | Máximo rendimiento | Doble mantenimiento |

Recomendación: Flutter cuando se haga, por el rendimiento en listas de mensajes largas.
