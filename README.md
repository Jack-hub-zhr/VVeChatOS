# VVeChat OS 1.0.0

Clean single-service realtime chat: Express + Socket.io + SQLite serving both
the UI and the API from one URL (`https://<service>.onrender.com`).

## Layout
```
server.js        Express + Socket.io + better-sqlite3 + JWT (API + static host)
keepalive.js     Optional standalone keep-alive pinger (also built into server.js)
frontend/
  index.html     UI shell
  style.css      Liquid Glass theme
  app.js         Vanilla SPA client
  assets/        Wallpapers
```

## Deploy (Render)
| Field | Value |
|---|---|
| Root Directory | *(empty)* |
| Build Command | `npm ci` (or `npm install`) |
| Start Command | `npm start` |
| Instance Type | Free |

### Environment variables
| Key | Value | Why |
|---|---|---|
| `NODE_VERSION` | `18` | better-sqlite3 11.x ships prebuilds for Node 18; Node 22 crashes |
| `DB_FILE` | `/var/data/vvechat.db` | Render Free disk is ephemeral — point this at a mounted disk |
| `KEEPALIVE` | *(unset)* or `0` to disable | `0` disables the internal keep-alive timer |
| `KEEPALIVE_INTERVAL_MS` | `600000` | 10-minute ping interval |
| `ALLOW_ORIGIN` | *(unset)* | set to `*` only when serving the frontend elsewhere |

### Persistent disk (strongly recommended)
Render → Service → **Disk** → Create Disk
- Name: `vvechat-data`
- Mount Path: `/var/data`
- Size: `1 GB`

Then set `DB_FILE=/var/data/vvechat.db`. Without this, every container restart
wipes accounts, groups and messages.

## Default admin
- Username `Jack`
- Password `Zhr121005`

Created automatically on first boot along with the official group, and every
registered account is (re)joined to the official group on every boot.

## Security
- Security headers incl. a strict Content-Security-Policy
- `X-Powered-By` disabled, `trust proxy` enabled for correct client IPs
- CORS locked to same-origin (override with `ALLOW_ORIGIN`)
- Per-IP rate limiting: 300 req/min global, 12/min on login+register,
  60/min on mutating routes
- Passwords hashed with bcrypt; JWTs signed with `JWT_SECRET`
  (set this in production)
