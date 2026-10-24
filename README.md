# Booking Appointment System

Web booking for the clinics of a Japanese medical corporation (demo data: 医療法人社団 誠和会 / Seiwa Medical
Corporation, three clinics: たなか内科クリニック 本院 · 駅前院 · 西口院). Patients find a doctor, book, change or cancel
a visit, answer the first-visit questionnaire and manage family members, in **Japanese, English or Vietnamese**.
Reception, doctors and administrators run the booking ledger, proxy bookings, patient records, the clinic calendar,
doctor shifts, masters, notification templates, staff accounts and CSV export (staff screens are Japanese).

**Demo manual (screens, guided tour, roles, batches):** [`docs/manual/index.html`](docs/manual/index.html) — open it
in a browser; it works offline.

| Role | Screens |
|---|---|
| Patient (and family proxy) | P01–P16: top, login, register, password reset, my page, family, doctor search / detail, clinics, booking entry → questionnaire → confirm → done, my bookings, booking detail |
| Reception | S01 ledger, S02 proxy booking, S03 patients, A06 CSV export; A01 / A02 / A03 read-only |
| Doctor | S01 (own bookings), A02 (own shifts), read-only |
| Admin | everything above plus A01 calendar, A02 shifts, A03 masters, A04 templates and cancellation policy, A05 staff accounts |

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Prisma 7 + PostgreSQL 17 · Tailwind CSS 4 · Zod · JWT (`jose`)
sessions in httpOnly cookies · bcrypt · Leaflet (clinic map) · Jest 30. **Node 22** is required (Next 16 and Prisma 7
do not run on Node 18).

## Quick start

### Development — npm

Needs Node 22 and a PostgreSQL 17 server (any; one in Docker:
`docker run -d --name booking-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=booking_appointment -p 127.0.0.1:5432:5432 postgres:17-alpine`).

```bash
cp .env.example .env              # the DATABASE_URL in it points at localhost:5432, user postgres / postgres
npm install --no-package-lock     # the lock only resolves macOS arm64 native packages
npx prisma generate
npx prisma migrate deploy         # creates the 31 tables
npm run seed                      # demo data (destructive: drops and recreates all rows)
npm run dev                       # http://localhost:3000
```

### Development — Docker only (no local Node)

```bash
docker network create booking-dev
docker run -d --name booking-pg --network booking-dev -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=booking_appointment postgres:17-alpine
docker run --rm -it --network booking-dev -p 127.0.0.1:3000:3000 -v "$PWD":/app -w /app \
  -e DATABASE_URL="postgresql://postgres:postgres@booking-pg:5432/booking_appointment?schema=public" \
  -e JWT_SECRET=local-dev-only-secret-0123456789abcdef node:22-bookworm \
  sh -c "npm install --no-package-lock && npx prisma generate && npx prisma migrate deploy && npm run seed && npx next dev -H 0.0.0.0"
```

### Production — `docker-compose.yml`

The Dockerfile `runner` stage (`next build`, standalone server) with its own PostgreSQL; migrations run at start.
The demo listens on **http://127.0.0.1:3100**:

```bash
cp .env.example .env
# in .env: APP_PORT=3100, APP_BASE_URL=http://127.0.0.1:3100,
#          POSTGRES_PASSWORD, JWT_SECRET, FIELD_ENCRYPTION_KEY (long random values)
docker compose up -d --build
```

The runner image has no dev dependencies: seed it from a development checkout pointed at this database
(`DATABASE_URL=… npm run seed`). Production sets `Secure` cookies; browsers accept them over plain HTTP on
`localhost` / `127.0.0.1` only — anywhere else serve it over HTTPS. Health: `GET /api/health` → 200.

## Demo accounts

Every account's password is **`Demo1234`**.

| Account | Role | Notes |
|---|---|---|
| `yamada.taro@example.jp` | patient (ja) | has family members and bookings — the main demo patient |
| `suzuki.ichiro@example.jp` | patient (ja) | |
| `emily.smith@example.com` | patient (en) | |
| `nguyen.van.an@example.com` | patient (vi) | |
| `reception.honin@example.jp` | reception | 本院 |
| `reception.multi@example.jp` | reception | 本院 + 駅前院 (clinic switcher) |
| `doctor.tanaka@example.jp` | doctor | D001 田中 誠 |
| `doctor.kobayashi@example.jp` | doctor | D007 小林 直樹 |
| `admin.honin@example.jp` | admin | 本院 |
| `admin.all@example.jp` | admin | all clinics |
| `sasaki.pending@example.jp` | patient | edge case: mail not verified → resend prompt (PE017) |
| `reception.firstlogin@example.jp` | reception | edge case: must change the password at first login |
| `reception.noclinic@example.jp` | reception | edge case: no clinic assigned → 403 screen |
| `reception.disabled@example.jp` | reception | edge case: disabled account → login refused |

## Environment

Every variable the app reads is in [`.env.example`](.env.example) with its default.

| Variable | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL URL of the app and the seed |
| `POSTGRES_URL_NON_POOLING` | with a pooler | direct URL for Prisma Migrate (PgBouncer setups) |
| `JWT_SECRET` | yes | session signing, ≥ 32 characters |
| `FIELD_ENCRYPTION_KEY` | production | AES-256-GCM key of questionnaire answers, booking notes and export files (dev falls back to `JWT_SECRET`) |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `docker-compose.yml` | database container |
| `NODE_ENV` | yes | `production` = secure cookies, HSTS |
| `APP_PORT` | no | host port of `docker-compose.yml` (default 9105) |
| `APP_BASE_URL` | no | base of the links in mails |
| `CORS_ALLOWED_ORIGINS` | no | listed for deployments, not read: state-changing requests must be same-origin |
| `TRUSTED_PROXY_HOPS` | no | proxies whose `X-Forwarded-For` is trusted (default 0) |
| `BOOKING_WINDOW_DAYS`, `BCRYPT_ROUNDS`, `RATE_LIMIT_*`, `CACHE_TTL_*` | no | booking horizon, hashing cost, rate limits, caches |
| `BATCH_SCHEDULER` | no | `on` = jobs B1–B6 and the notification retry run in-app; default `off` |
| `OPS_ALERT_EMAIL` | no | extra recipient of batch failure alerts |
| `NOTIFY_OUTBOX_DIR`, `EXPORT_DIR`, `PHOTO_DIR` | no | files under `var/` (outbox, export files, doctor photos) |
| `NOTIFY_TRANSPORT` | no | `fake` (default): mail / SMS / LINE messages are written to the outbox |
| `LINE_LOGIN`, `LINE_CHANNEL_ID`, `LINE_CHANNEL_SECRET` | no | LINE Login; `fake` by default |
| `X1_WEBHOOK_SECRET` | no | shared secret of the delivery-status webhook |
| `X3_SOURCE`, `X4_SOURCE` | no | holiday and postcode sources; the repo's `fixtures/` by default |

The `JWT_SECRET` / `FIELD_ENCRYPTION_KEY` values in `.env.example` and in any demo setup are **demo only** — never
reuse them.

## Scripts

| Command | What |
|---|---|
| `npm run dev` / `build` / `start` | Next dev server / production build / production server |
| `npm test` | Jest, in its own database `<db>_test` (reset and seeded at each start) |
| `npm run typecheck` · `npm run lint` | `tsc --noEmit` · ESLint |
| `npm run seed` | demo data (destructive) |
| `npm run batch -- <B1…B6> [--clinic honin] [--dry-run]` | run one batch job now; prints the run as JSON (exit 0 ok, 1 failed, 2 usage) |

Batch jobs (times Asia/Tokyo, used by the in-app scheduler):

- **B1** 前日リマインド — reminders for tomorrow's bookings (mail / LINE / SMS), at each clinic's reminder time (10:00).
- **B2** 枠生成 — builds bookable slots from the calendar, shifts and policy; daily 01:00 and after A01 / A02 / A04 saves.
- **B3** 祝日取込 — imports national holidays; 1st of the month 01:45 and from A01.
- **B4** 夜間締め — nightly close, marks no-show candidates; daily 00:30.
- **B5** 保存期間削除 — deletes or anonymises data past its retention period; daily 01:30.
- **B6** レセコンCSV夜間出力 — patient and booking CSV (CP932) for the receipt system into `EXPORT_DIR`, listed on A06; daily 05:30.

## Project layout

```
app/(patient)/     patient screens P01–P16 (CF-01 header, CF-02 footer)
app/(staff)/       staff and admin screens S01–S03, A01–A06 (CF-03 header)
app/(logo-only)/   re-consent and first-login password change
app/api/           route handlers (auth, booking, mypage, staff, admin, webhooks, health)
components/        frame/ (headers, error screens), ui/ (kit), public/, patient/, booking/
lib/               auth/, booking/ (the only create / change / cancel path), batch/ (B1–B6), notify/, i18n/,
                   admin/, staff/, patient/, public/, export/, adapters/ (X2–X5), crypto/
prisma/            schema.prisma, migrations/, seed.ts (+ seed-accounts.ts)
fixtures/          holiday CSV (X3) and postcodes (X4) used offline
bin/               batch.ts (batch CLI), run-ts.mjs
tests/             Jest tests
docs/manual/       demo manual (HTML)
```

## Known limits

- **Single instance.** Login guard, rate limits and the booking draft live in process memory: run one app instance
  (several instances would need a shared store).
- **`FIELD_ENCRYPTION_KEY` has no rotation.** Losing or changing it makes questionnaire answers, booking notes and
  stored export files unreadable.
- **Fake transports.** Mail, SMS and LINE are not sent: with `NOTIFY_TRANSPORT=fake` each message is a file in
  `NOTIFY_OUTBOX_DIR` (`var/outbox`). LINE Login is a fake as well.
- **Scheduler off by default.** B1–B6 run on their own only with `BATCH_SCHEDULER=on`; otherwise `npm run batch`.
- **Clinic map is a demo add-on.** P01 / P10 / P11 show an OpenStreetMap map (Leaflet, bundled; no API key, cookies,
  geolocation or analytics; attribution © OpenStreetMap contributors). Pins come from `clinics.latitude` /
  `longitude`; without coordinates there is no map. The CSP allows `https://tile.openstreetmap.org` for images only;
  offline the map is a grey box with its pins.
