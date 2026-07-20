# GitPushNotifier

Aplicación de escritorio para **Windows** (Electron) que autentica usuarios con GitHub, monitorea uno o varios repositorios y muestra una **notificación nativa** cuando hay un nuevo push en cualquier branch.

## Estrategia de detección de pushes: Polling

Este proyecto usa **polling periódico** contra la API de GitHub (`GET /repos/{owner}/{repo}/events`), no webhooks.

### ¿Por qué no webhooks?

Los webhooks de GitHub requieren un endpoint **HTTPS público** que reciba `POST` en tiempo real. Una app Electron instalada en el PC de cada miembro del equipo **no expone** ese endpoint por sí sola. Para usar webhooks haría falta:

- un túnel (ngrok, Cloudflare Tunnel), o
- un backend/relay en la nube que reciba el webhook y avise a cada cliente

Eso añade infraestructura, configuración y superficie de seguridad (validación de firma `X-Hub-Signature-256`, exposición pública, etc.). Para un cliente de escritorio puro, **polling es la opción más realista y mantenible**.

### Cómo funciona el polling

1. Tras cada ciclo, `getPollIntervalMs()` / el intervalo elegido en la UI decide el delay hasta el siguiente poll (por defecto **60 s** vía `POLL_INTERVAL_MS`). Se consultan los eventos de cada repo monitoreado.
2. Se envía el header `If-None-Match` (ETag) para evitar descargas innecesarias cuando no hubo cambios (`304 Not Modified`).
3. Solo se consideran eventos `PushEvent` (cubre pushes en **cualquier branch**).
4. Se guarda `lastEventId` por repositorio en almacenamiento local para **no repetir** notificaciones del mismo push (también tras reiniciar la app).
5. La **primera** consulta tras agregar un repo solo establece una línea base (baseline): no notifica el historial antiguo.

Detalle de implementación: `services/pushMonitor.js`.

### Limitaciones

- La latencia máxima es el intervalo de polling (~60 s por defecto).
- La API de events de GitHub solo retiene una ventana reciente de eventos (~300).
- Los repos privados requieren el scope OAuth `repo`.
- Rate limits de GitHub aplican; el uso de ETag y un intervalo razonable mitiga el riesgo.

---

## Arquitectura

```
main/           Proceso principal de Electron (ventana, tray, IPC)
renderer/       UI (login + dashboard)
services/       GitHub OAuth, API, monitor de pushes, logger
config/         Configuración y variables de entorno
storage/        Persistencia local (electron-store)
notifications/  Notificaciones nativas de Windows
```

Separación de responsabilidades:

| Capa | Rol |
|------|-----|
| `main/` | Ciclo de vida Electron, bandeja del sistema, puente IPC |
| `renderer/` | Pantallas de login y dashboard |
| `services/githubAuth.js` | OAuth Authorization Code + callback en `127.0.0.1` |
| `services/githubApi.js` | Cliente REST de GitHub |
| `services/pushMonitor.js` | Polling y deduplicación de pushes |
| `services/autoUpdater.js` | Actualizaciones vía GitHub Releases (`electron-updater`) |
| `notifications/` | `Notification` nativa de Electron/Windows |
| `storage/` | Sesión, repos monitoreados, último evento por repo |
| `config/` | `CLIENT_ID` / `CLIENT_SECRET` vía `.env` |

---

## Requisitos previos

- Node.js 18+ (recomendado 20+)
- npm
- Una [OAuth App de GitHub](https://github.com/settings/developers)

### Crear la OAuth App en GitHub

1. GitHub → **Settings** → **Developer settings** → **OAuth Apps** → **New OAuth App**
2. Application name: `GitPushNotifier` (o el que prefieras)
3. Homepage URL: `http://127.0.0.1:42813` (puede ser cualquier URL válida)
4. **Authorization callback URL** (importante):

   ```
   http://127.0.0.1:42813/callback
   ```

5. Crea la app y genera un **Client secret**
6. Copia Client ID y Client secret al archivo `.env`

> El flujo OAuth abre el navegador del sistema y un servidor HTTP temporal en el proceso main escucha el callback en localhost. El `CLIENT_SECRET` nunca se envía al renderer.

---

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar secretos
copy .env.example .env
# Edita .env con tu GITHUB_CLIENT_ID y GITHUB_CLIENT_SECRET
```

En PowerShell también puedes usar:

```powershell
Copy-Item .env.example .env
```

---

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `GITHUB_CLIENT_ID` | Client ID de la OAuth App | _(requerido)_ |
| `GITHUB_CLIENT_SECRET` | Client secret de la OAuth App | _(requerido)_ |
| `GITHUB_REDIRECT_URI` | Debe coincidir con la callback URL de la OAuth App | `http://127.0.0.1:42813/callback` |
| `OAUTH_CALLBACK_PORT` | Puerto del servidor local de callback | `42813` |
| `POLL_INTERVAL_MS` | Valor por defecto que usa `getPollIntervalMs()` (ms) | `60000` |
| `GH_PUBLISH_OWNER` | Usuario/org del repo de Releases (auto-updates) | _(requerido para dist/release)_ |
| `GH_PUBLISH_REPO` | Nombre del repo de Releases | _(requerido para dist/release)_ |
| `GH_TOKEN` | PAT para subir Releases (`npm run release`) | _(solo al publicar)_ |

---

## Ejecutar

```bash
# Desarrollo / uso normal
npm start

# Alias de desarrollo
npm run dev
```

### Empaquetar para Windows

Configura en `.env` al menos `GH_PUBLISH_OWNER` y `GH_PUBLISH_REPO` (el repo debe existir en GitHub). Esos valores se graban en el instalador para que las actualizaciones sepan dónde buscar.

```bash
# Instalador NSIS en dist/ (sin subir a GitHub)
npm run dist

# Build + publicar release en GitHub (necesita GH_TOKEN)
npm run release
```

---

## Actualizaciones automáticas (GitHub Releases)

**Sí: es gratis** en repositorios **públicos** (cuotas generosas de almacenamiento/transferencia). En repos privados también hay cuota gratis, pero el cliente necesita poder leer el release (más simple dejar el repo de releases público).

### Cómo funciona

1. Tú subes la versión en `package.json` (ej. `1.1.0` → `1.2.0`).
2. Ejecutas `npm run release` → se crea un **GitHub Release** con el `.exe` y `latest.yml`.
3. Las apps ya instaladas consultan ese feed al arrancar, descargan la update y muestran **Reiniciar e instalar** en el dashboard.

No hay push a cada PC: cada instalación **consulta** Releases. El primer instalador que repartas ya debe incluir el auto-updater (este código).

### Pasos para publicar la primera vez

1. Crea un repo vacío en GitHub (público recomendado), p. ej. `github-notifications`.
2. En `.env`:
   ```
   GH_PUBLISH_OWNER=tu-usuario
   GH_PUBLISH_REPO=github-notifications
   GH_TOKEN=ghp_…   # scope repo
   ```
3. `npm run release`
4. Distribuye el `GitPushNotifier-Setup-….exe` del release (o de `dist/`).
5. Para la siguiente versión: sube `version` en `package.json` y vuelve a `npm run release`.

> `npm start` **no** comprueba updates (solo builds empaquetados). El chequeo automático corre cada **30 minutos**; el banner verde solo aparece si hay una update nueva. Puedes forzar un chequeo con **Buscar updates** en la barra superior.

---

## Uso

1. Inicia la app e inicia sesión:
   - **OAuth** (botón de GitHub), o
   - **Personal Access Token** si eres colaborador de una org que bloquea OAuth Apps
2. En el dashboard, agrega repositorios con el formato `owner/repo`.
3. El monitoreo arranca automáticamente tras el login (configurable en storage).
4. Ante un push nuevo verás una notificación nativa con:
   - nombre del repositorio
   - branch
   - autor
   - mensaje del commit más reciente
5. Cierra la ventana para minimizar a la **bandeja del sistema**; la app sigue monitoreando.
6. Usa **Probar notificación** para verificar el sistema de notificaciones sin esperar un push.
7. El icono de engranaje en la barra superior abre **Configuración** (iniciar con Windows). El icono de altavoz abre el menú de sonido MP3.

### Login con PAT (organizaciones con OAuth restringido)

Como colaborador del repo puedes usar un token propio (no es una “app de terceros”):

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens**
2. **Classic:** scope `repo` · **Fine-grained:** lectura sobre ese repositorio
3. En la app, pégalo en **Entrar con PAT** y agrega `owner/repo`

No compartas el token; queda solo en el almacenamiento local de Electron.

### Manejo de errores

| Situación | Comportamiento |
|-----------|----------------|
| Fallo de autenticación / timeout OAuth | Mensaje en la pantalla de login; log en UI y archivo |
| Token expirado o inválido | Sesión limpiada; se pide volver a iniciar sesión; el monitor se detiene |
| Problemas de red | Error en estado del monitor + logs; se reintenta en el siguiente ciclo |
| Repo sin permisos / 404 | Aviso en estado/logs; ese repo se omite en el ciclo actual |

---

## Persistencia local

Con `electron-store` se guarda en el directorio de datos de usuario de Electron:

- sesión básica (token + perfil)
- lista de repositorios monitoreados
- `lastEventId` / ETag / último push por repositorio
- preferencias (minimizar a bandeja, auto-inicio del monitor)

Los logs también se escriben en `git-push-notifier.log` dentro de ese directorio.

---

## Scripts npm

| Script | Acción |
|--------|--------|
| `npm install` | Instala dependencias |
| `npm start` / `npm run dev` | Ejecuta la app con Electron |
| `npm run pack` | Empaqueta sin instalador |
| `npm run dist` | Genera instalador Windows (NSIS) |
| `npm run release` | Genera instalador y lo publica en GitHub Releases |

---

## Licencia

MIT
