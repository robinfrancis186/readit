# Putting Readit online

Readit is a Node server with a SQLite database and your book files on disk. That
shapes every choice here.

## What GitHub Pages can and cannot do

GitHub Pages serves static files. It runs no code, has no database and no disk,
so **Readit itself cannot run on Pages**. What is published there is the project
page in `site/` — a description with screenshots, deployed by
`.github/workflows/pages.yml`.

Enabling it is a one-time repository setting only an admin can change:

> Settings → Pages → Build and deployment → Source: **GitHub Actions**

After that, every push to `main` that touches `site/` republishes the page at
`https://<user>.github.io/readit/`.

To use Readit from more than one device you need a host that runs Node and keeps
a disk. The rest of this page covers that.

## Before you expose it: set a password

Readit has no accounts. Left open, anyone who finds the URL can read your
library, your notes, and delete both.

```bash
READIT_PASSWORD='a long passphrase' npm start
```

With it set, every `/api` route requires a signed session cookie, and the web app
shows a sign-in screen. Without it, Readit binds to loopback and warns on startup
if you widen that. **Never deploy to a public host without it.**

The signing secret is generated once and stored in the database, so sessions
survive restarts and redeploys. Sessions last 30 days
(`READIT_SESSION_DAYS`). Failed sign-ins are throttled per IP.

## Docker

One image, one process — the API also serves the built web app.

```bash
docker build -t readit .
docker run -p 4000:4000 \
  -v readit-data:/data \
  -e READIT_PASSWORD='a long passphrase' \
  readit
```

The `-v` is not optional in any real deployment. `/data` holds the SQLite
database and every file you have imported; without a volume, a redeploy starts
you with an empty library.

## Fly.io

Fly gives a small always-on machine and a persistent volume, which is the
cheapest fit for something that must keep files.

```bash
fly launch --no-deploy --copy-config     # uses the committed fly.toml
fly volumes create readit_data --size 3  # GB; grow it later with `fly volumes extend`
fly secrets set READIT_PASSWORD='a long passphrase'
fly deploy
```

Notes:

- `primary_region` in `fly.toml` is `sin` (Singapore). Change it to whatever is
  near you; latency on page turns is noticeable.
- `auto_stop_machines = "suspend"` lets the machine sleep when idle and wake on
  the next request. The first request after a sleep is slow.
- Keep it to **one machine**. The database and the books live on one volume;
  running two would give you two divergent libraries.

## Render

`render.yaml` is a blueprint — point Render at the repo and it reads it.

Render's **free** web services have no persistent disk, so your library would be
erased on every deploy. The blueprint therefore asks for a `starter` instance
with a 3 GB disk, which is paid. Set `READIT_PASSWORD` in the dashboard; it is
marked `sync: false` so it is never committed.

## Any other host

Anything that runs a container and mounts a volume works. Readit needs:

| | |
| --- | --- |
| Runtime | Node 20+, or the Docker image |
| Persistent disk | for `READIT_DATA_DIR` (default `/data` in the image) |
| Memory | 512 MB is comfortable |
| Disk size | ~7 MB of dictionaries, plus your books |

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `READIT_PASSWORD` | – | Required on any public host |
| `READIT_DATA_DIR` | `./data` | Database, imported files, covers |
| `HOST` | `127.0.0.1` | Set to `0.0.0.0` when containerised |
| `PORT` | `4000` | |
| `READIT_SESSION_DAYS` | `30` | How long a sign-in lasts |
| `READIT_MAX_UPLOAD` | 512 MB | Per-file upload limit |
| `OXFORD_APP_ID` / `OXFORD_APP_KEY` | – | Optional Oxford provider |

Put TLS in front of it. The session cookie is marked `Secure` when the request
arrives over https (`X-Forwarded-Proto` is honoured), and `HttpOnly` and
`SameSite=Lax` always.

## Backups

Everything is in one directory:

```bash
docker run --rm -v readit-data:/data -v "$PWD:/backup" \
  busybox tar czf /backup/readit-backup.tar.gz /data
```

Or on Fly, `fly ssh console` and copy `/data` out. The SQLite database is in WAL
mode, so copy `readit.db`, `readit.db-wal` and `readit.db-shm` together, or stop
the app first.

## What is not solved

- **One machine only.** SQLite on a local volume does not scale horizontally.
  For one reader that is the right trade; it is not a design that survives being
  shared.
- **No sync.** There is one library on one server that every device talks to.
  Devices do not hold their own copy, so offline reading is not available — the
  installed app opens offline but needs the server for its contents.
- **One password, no accounts.** Readit is single-user by design. Sharing the
  password shares everything, including deletion.
