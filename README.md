# Samar

Samar is a self-hosted chat application with an Angular web client, an Express API, MongoDB persistence, and an OpenAI-compatible language-model provider.

## Features

- Register, sign in, refresh sessions, sign out, and manage account credentials.
- Chat with a configured language model and manage saved discussions.
- Choose whether conversation history is saved.
- Edit profile details and upload a profile photo.
- Set language (English, French, or Arabic) and light/dark theme preferences.
- Use browser speech recognition and speech synthesis where supported.
- Serve the production frontend over HTTPS through NGINX.

## Architecture

```text
Browser
  └── NGINX (frontend container, ports 4200 and 8443)
        ├── Angular static files
        └── /api/* → Express backend (port 5000 inside Compose)
                         ├── MongoDB
                         └── OpenAI-compatible LLM provider
```

The backend API routes are mounted at `/users`, `/chat`, `/profile`, and `/preferences`. NGINX proxies `/api/...` to the backend without removing the `/api` prefix; the production Angular build uses `/api` as its backend base URL.

## Run with Docker Compose

### Requirements

- Docker Desktop with Docker Compose.
- A local certificate authority and certificate for HTTPS; see [Local HTTPS certificates](#local-https-certificates).
- An API key and model name for an OpenAI-compatible language-model service.

### Configure environment

In PowerShell, from the repository root:

```powershell
Copy-Item .env.example .env
```

Edit `.env` and replace every placeholder. Use strong, unique secrets. MongoDB credentials are embedded in a connection URI, so use URL-safe values (hexadecimal passwords are suitable).

For the Compose frontend, set the browser origin and secure-cookie flag to match the HTTPS URL:

```dotenv
CLIENT_ORIGIN=https://localhost:8443
COOKIE_SECURE=true
```

The example file's HTTP origin is for an HTTP development frontend; it does not match the HTTPS origin used by the Compose frontend. `LLM_BASE_URL` must be the API base URL supported by your provider, and `LLM_MODEL` must name a model available to your API key. `LLM_FALLBACK_MODEL` is optional.

### Create local HTTPS certificates

The NGINX configuration expects these files:

```text
certs/localhost.pem
certs/localhost-key.pem
```

One convenient local development option is [mkcert](https://github.com/FiloSottile/mkcert). Install it, then run:

```powershell
mkcert -install
New-Item -ItemType Directory -Force certs
mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1
```

`mkcert -install` creates and trusts a local CA on your machine; the second command creates a certificate for the listed local names. Restart the browser if it does not recognize the newly trusted CA. Each developer should create and trust their own local CA—do not share or commit the CA's private key.

The `certs` directory is ignored by Git. Never commit private keys. For an internet-facing deployment, use a certificate from a publicly trusted CA (or your organization's managed CA), configure the correct domain names, and review the NGINX redirect and host settings rather than using the localhost configuration unchanged.

### Start the app

```powershell
docker compose up --build -d
docker compose ps
```

Open **https://localhost:8443**. Port **4200** redirects to the HTTPS URL. Your browser may warn about the certificate until the local CA is trusted.

To follow service logs:

```powershell
docker compose logs -f backend
docker compose logs -f mongo
docker compose logs -f frontend
```

Stop the containers while keeping persisted data:

```powershell
docker compose down
```

Compose stores MongoDB data in the `mongo_data` named volume and uploaded profile photos in the `photos` named volume. `docker compose down` preserves these volumes. **Deleting the volumes permanently deletes the corresponding data.**

## Use the app

1. Open the HTTPS address and create an account from the registration screen.
2. Sign in, then start a conversation from the chat screen.
3. Use the discussion list to reopen, rename, or delete saved conversations.
4. Visit **Profile** to update account details, password, or profile photo.
5. Visit **Settings** to choose language/theme, enable or disable conversation-history saving, or delete saved discussions.

When conversation history is disabled, messages are sent to the configured model for a response but are not saved as discussions in MongoDB. Language selection, speech input, and speech output depend partly on browser capabilities and installed voices.

## Local development

### Angular frontend

```powershell
Set-Location frontend
npm ci
npm start
```

The development environment points to `http://localhost:5000`. The development frontend therefore needs a backend reachable at that address; the Compose backend is not published to the host by the current Compose configuration. The backend also needs a reachable MongoDB instance and its environment variables.

For a production Angular build:

```powershell
npm run build
```

### Express backend

```powershell
Set-Location backend
npm ci
npm run dev
```

The backend requires `JWT_SECRET`, `MONGODB_URI`, `LLM_API_KEY`, and `CLIENT_ORIGIN`; it also reads `PORT`, `COOKIE_SECURE`, `COOKIE_SAMESITE`, `COOKIE_PATH`, and `TRUST_PROXY` when configured. In Compose these are supplied by `docker-compose.yml`. For local development, provide equivalent values in the backend process environment and ensure the frontend origin matches `CLIENT_ORIGIN`.

The backend package currently defines no automated test suite. The frontend test command is:

```powershell
Set-Location frontend
npm test
```

## Configuration reference

| Variable | Purpose |
| --- | --- |
| `MONGO_ROOT_USER`, `MONGO_ROOT_PASSWORD` | MongoDB administrator account, used by the MongoDB container. |
| `MONGO_APP_USER`, `MONGO_APP_PASSWORD` | Application database user created by `mongo-init.sh`; used in the backend MongoDB URI. |
| `JWT_SECRET` | Secret used to sign access tokens. Use a strong random value and keep it private. |
| `CLIENT_ORIGIN` | Exact allowed browser origin for backend CORS, including scheme and port. |
| `COOKIE_SECURE` | Set to `true` when serving over HTTPS; the Compose frontend uses HTTPS. |
| `LLM_API_KEY` | Secret key for the language-model provider. |
| `LLM_BASE_URL` | Provider's OpenAI-compatible API base URL. |
| `LLM_MODEL` | Required model identifier. |
| `LLM_FALLBACK_MODEL` | Optional fallback model identifier. |
| `PORT` | Backend listen port; Compose sets it to `5000`. |

Other backend options include `COOKIE_PATH` (Compose sets `/api/users`), `COOKIE_SAMESITE`, and `TRUST_PROXY`. Do not commit `.env`, provider credentials, production secrets, or private certificate keys.

## API overview

All routes below are relative to the backend. In the production frontend, requests pass through NGINX under `/api`.

| Route | Purpose |
| --- | --- |
| `GET /health` | Backend health check. |
| `POST /users/register`, `POST /users/login` | Register and sign in. |
| `POST /users/refresh`, `POST /users/logout`, `POST /users/logout-all` | Refresh or revoke sessions. |
| `PATCH /users/change/password`, `DELETE /users/delete/me` | Change password or delete the current account. |
| `POST /chat/new` | Send a chat message. |
| `GET /chat/discussions`, `GET /chat/discussions/:id/messages` | List discussions or fetch messages. |
| `PATCH /chat/discussions/:id` | Rename a discussion. |
| `DELETE /chat/discussions`, `DELETE /chat/discussions/:id` | Delete discussions. |
| `GET /profile/me`, `PATCH /profile/me`, `POST /profile/me/photo` | Read/update profile and upload a photo. |
| `GET /preferences`, `PATCH /preferences`, `PUT /preferences` | Read or update user preferences. |

Most account, chat, profile, and preference routes require authentication.

## Making changes

- **Frontend UI or translations:** edit files under `frontend/src/app` or `frontend/public/lan`; run `npm test` and `npm run build` from `frontend`.
- **Backend behavior or API:** edit `backend` sources; run the backend locally or rebuild the image with `docker compose up --build -d backend`.
- **Proxy, headers, or TLS behavior:** edit `frontend/nginx.conf` or `frontend/security-headers.conf`; rebuild the frontend with `docker compose up --build -d frontend`.
- **Container or service configuration:** edit `docker-compose.yml`, the relevant `Dockerfile`, or `mongo-init.sh`, then recreate/rebuild the affected service as appropriate.
- **Environment variable changes:** update `.env.example` when adding or renaming configuration, and document the variable here. Keep real values only in the ignored `.env`.

After changing Compose or container configuration, check service state with `docker compose ps` and inspect the relevant service logs if a health check fails.

## Troubleshooting

### Backend is unhealthy or reports MongoDB authentication failure

Check `docker compose logs --tail 100 backend` and verify `MONGO_APP_USER` and `MONGO_APP_PASSWORD` in `.env`. The MongoDB initialization script creates the app user only when the data directory is first initialized. Editing `.env` later does **not** change credentials in an existing `mongo_data` volume. Restore matching credentials or intentionally update the existing MongoDB user and migrate data to the `Samar` database; do not remove the volume unless you accept losing its database contents.

### Frontend does not start because certificate files are missing

Confirm both expected certificate files exist in `certs` and that the certificate covers `localhost`. Recreate the local certificate using the commands above.

### Browser reports an untrusted or mismatched certificate

Trust the local CA with `mkcert -install`, use `https://localhost:8443`, and ensure the certificate includes the hostname used in the address bar. A certificate for `localhost` does not automatically validate a LAN IP address or a custom domain.

### Sign-in, refresh, or CORS problems

For Compose, browse via `https://localhost:8443`, set `CLIENT_ORIGIN` to that exact origin, and set `COOKIE_SECURE=true`. After changing environment values, recreate the backend:

```powershell
docker compose up -d --force-recreate backend
```

### Language-model errors

Check the backend logs and verify the provider API key, base URL, model name, provider quota, and network access. Chat requests are made by the backend, so the browser does not need direct access to the provider.
