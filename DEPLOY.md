# Deploy a Railway (backend) + Vercel (frontend)

Botwa se deploya como **monorepo**: backend en Railway con un solo service que corre API + worker vía Procfile, frontend en Vercel.

## Arquitectura

```
GitHub repo: botwa
├── Railway (1 service)
│   ├── web    → Fastify :3000 (REST + webhooks)
│   └── worker → BullMQ processor
├── Vercel (1 project)
│   └── Vite build del subdirectorio web/
├── Neon (free)  → Postgres
└── Upstash (free) → Redis
```

## Prerequisitos

- Cuenta [Railway](https://railway.app) (requiere tarjeta, plan Hobby $5/mes)
- Cuenta [Vercel](https://vercel.com) (free)
- Cuenta [Neon](https://neon.tech) (free)
- Cuenta [Upstash](https://upstash.com) (free)
- Repo en GitHub

## 1. Servicios externos (crear ANTES del deploy)

### Neon Postgres

1. [neon.tech](https://neon.tech) → Sign up
2. **New Project** → name `botwa`, region **Oregon**
3. **Connection Details** → copia el `DATABASE_URL` (formato `postgresql://...`)
4. Por defecto Neon bloquea IPs externas → en el panel del proyecto, **Trusted IPs** → allow all (o las IPs de Railway según región)

### Upstash Redis

1. [upstash.com](https://upstash.com) → Sign up
2. **Create Database** → Type: Redis, region **US-West-1** (más cerca de Oregon)
3. Copia `REDIS_URL` (formato `rediss://...`)

### Meta App

1. [developers.facebook.com](https://developers.facebook.com) → tu App (`972013382563184`)
2. Anotá `META_APP_ID`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`
3. Una vez aprobado el App Review, te da el `META_CONFIG_ID`

## 2. Deploy backend en Railway

### 2.1 Crear proyecto

1. Railway Dashboard → **New Project** → **Deploy from GitHub repo**
2. Seleccioná tu repo `botwa`
3. Railway detecta el `Procfile` automáticamente → te crea un service con 2 procesos (`web` + `worker`)
4. **Variables** → pegá una por una (Railway pasa las env vars también al build, así que las migraciones Prisma las van a usar):

```
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgresql://...    # de Neon
REDIS_URL=rediss://...           # de Upstash
APP_URL=https://botwa-api-production.up.railway.app   # actualizar después del primer deploy
WEB_ORIGIN=https://botwa.vercel.app                      # actualizar después del deploy de Vercel

S3_ENDPOINT=https://...
S3_REGION=auto
S3_BUCKET=...
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=true

META_ACCESS_TOKEN=EAAN...
META_APP_SECRET=...
META_APP_ID=972013382563184
META_CONFIG_ID=                  # dejar vacío hasta que Meta apruebe
META_REDIRECT_URI=               # dejar vacío hasta que Meta apruebe
META_WEBHOOK_VERIFY_TOKEN=...    # algún string random, no "wabot"
META_GRAPH_API_VERSION=v23.0

EMAIL_FROM=Botwa <login@example.com>
# RESEND_API_KEY=re_...          # opcional

SUPERADMIN_EMAIL=demo@botwa.dev
SUPERADMIN_PASSWORD=admin123
```

5. Click **Deploy**. Primer build toma ~3-5 min.

> **Nota sobre migraciones**: el `railway.toml` corre `prisma migrate deploy` como último paso del **build**. Nixpacks no incluye la carpeta `prisma/` en la imagen final del runtime (sólo el cliente generado), así que las migraciones se ejecutan durante el build cuando `prisma/schema.prisma` todavía está disponible. El `DATABASE_URL` llega al build automáticamente porque Railway expone las variables al contexto de build.

### 2.2 Generar dominio público

1. Una vez deployado, click en el service → **Settings** → **Networking** → **Generate Domain**
2. Railway te asigna `https://botwa-api-production.up.railway.app` (o similar)
3. **Actualizá** `APP_URL` con ese valor exacto → redeploy automático

### 2.3 Configurar Meta para que apunte a Railway

En [Meta Business](https://business.facebook.com) → WhatsApp Manager → Configuration → **Webhook**:

- Callback URL: `https://botwa-api-production.up.railway.app/webhook`
- Verify token: el mismo que `META_WEBHOOK_VERIFY_TOKEN`
- Click **Verify and Save** → debería quedar "Verified" verde
- Subscribe a `messages` y `message_template_status_update`

## 3. Deploy frontend en Vercel

1. [vercel.com](https://vercel.com) → **Add New Project**
2. **Import** tu repo `botwa`
3. Configuración:

| Campo | Valor |
|---|---|
| Framework Preset | Vite (auto) |
| Root Directory | **`web`** |
| Build Command | `npm run build` |
| Output Directory | `dist` |

4. **Environment Variables**:

```
VITE_API_URL=https://botwa-api-production.up.railway.app
```

5. Click **Deploy**. Toma ~1 min.

## 4. Activar Embedded Signup cuando Meta apruebe

Una vez que Meta te dé el **Configuration ID** (UUID):

1. Railway → service → Variables:
   - `META_CONFIG_ID=<uuid>`
   - `META_REDIRECT_URI=https://botwa-api-production.up.railway.app/v1/auth/meta/callback`
   - `WEB_ORIGIN=https://botwa.vercel.app`
2. Save → redeploy automático

3. Meta → App → WhatsApp → Configuration → **Embedded Signup** → Set Up:
   - Redirect URI: `https://botwa-api-production.up.railway.app/v1/auth/meta/callback` (EXACTO)
   - Scopes: `whatsapp_business_management`, `whatsapp_business_messaging`
   - Save → te genera el Configuration ID (el mismo que ya pegaste)

## 5. Verificación post-deploy

```powershell
# Backend responde
curl https://botwa-api-production.up.railway.app/health/live
# → {"status":"ok"}

# Frontend carga
# Abrí https://botwa.vercel.app en el browser
```

1. Login con `demo@botwa.dev` / `admin123`
2. Creá un Negocio o usá uno existente
3. Andá a Configuración

**Si `META_CONFIG_ID` está vacío**: ves el form "displayName + displayPhone" (flow legacy mock).

**Si está seteado**: ves el botón "Continuar con Facebook".

## 6. Test con número de prueba (Meta)

1. Meta App → WhatsApp → API Setup → copiá el **Phone Number ID del test number** (Meta te da uno gratis)
2. Conectá ese número al Botwa via Embedded Signup (login Facebook → seleccionar test number → Meta manda PIN)
3. Mandá un mensaje desde tu WhatsApp real al número de prueba → debe aparecer en la Bandeja

## 7. Switch a tu número real

Una vez que el test number funcione:

1. Meta → WhatsApp Manager → desconectá el test number
2. Conectá tu número real (`1276692908855446`) via Embedded Signup
3. Meta manda PIN por SMS/llamada a tu número → ingresalo en Botwa

## Troubleshooting

| Problema | Solución |
|---|---|
| `Cannot find module '@prisma/client'` | El `prisma:generate` no corrió en build. Verificá que `railway.toml` lo incluya |
| `P1001 Can't reach database` | `DATABASE_URL` mal copiado o Neon bloquea IPs. En Neon: Trusted IPs → allow all |
| `prisma migrate deploy` falla | La DB existe pero no tiene migrations aplicadas. Verificá que `DATABASE_URL` apunte a la DB correcta |
| Webhook verification falla (Meta) | El `META_WEBHOOK_VERIFY_TOKEN` no coincide entre Railway y Meta dashboard |
| Vercel 404 en rutas SPA | Asegurate que `web/vercel.json` tenga el rewrite a `/index.html` |
| CORS error en browser | `WEB_ORIGIN` en Railway no coincide con la URL de Vercel (sin trailing slash) |
| `WebSocket` no conecta | Railway free tiene timeout en HTTP/2 streams. Upgrade a plan pago si usás realtime |
| Logs no aparecen en Railway | Railway → service → **Logs** tab |

## Comandos útiles localmente

```powershell
# Simular el entorno de Railway localmente
docker compose up -d postgres redis
npm run prisma:migrate
npm run dev          # api
npm run dev:worker   # worker en otra terminal
npm run web:dev      # frontend en otra terminal
```

## Archivos de deploy

- `Procfile` — procesos web y worker (Railway)
- `railway.toml` — build + start + healthcheck
- `web/vercel.json` — rewrites SPA
- `package.json` scripts `start` / `start:worker` — usan `--env-file-if-exists` para no fallar en prod