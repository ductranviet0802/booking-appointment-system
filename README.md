# Booking Appointment System

Ứng dụng đặt lịch khám bệnh trực tuyến xây dựng bằng Next.js App Router, Prisma ORM và PostgreSQL.

## Tech stack

- Next.js 16 + TypeScript
- Prisma ORM + PostgreSQL
- JWT (`jose`) + cookie httpOnly
- Tailwind CSS
- Zod validation
- Jest unit test

## Environment

Tạo file `.env` từ `.env.example`:

```bash
cp .env.example .env
```

Biến môi trường bắt buộc:

- `DATABASE_URL`
- `POSTGRES_URL_NON_POOLING` (bắt buộc cho Prisma Migrate trên môi trường có pooler/PgBouncer)
- `JWT_SECRET` (>= 32 ký tự)
- `NODE_ENV`

Biến môi trường khuyến nghị (CORS):

- `CORS_ALLOWED_ORIGINS` (danh sách origin ngăn cách bởi dấu phẩy, dùng cho production nếu gọi API khác origin)

Client address behind a reverse proxy (rate limits N-SEC-03, `audit_logs.ip`):

- `TRUSTED_PROXY_HOPS` — the number of proxies in front of the app that append to `X-Forwarded-For` (Caddy alone: `1`).
  Default `0`: `X-Forwarded-For` is not trusted. With N the N-th address from the right is the client. Set it to the real
  number of hops: a higher value lets a client choose its own address.
- No usable address (default `0`, or a header shorter than N): the per-IP limits are skipped for that request (the
  per-address limits of login / register / resend / reset still apply) and `audit_logs.ip` stays empty — requests without
  an address never share one bucket that a single client could fill for everyone.

Lưu ý TLS cho PostgreSQL hosted:

- Nếu bạn dùng URL có `sslmode=require`, `pg` sẽ cảnh báo về thay đổi semantics ở version lớn tiếp theo.
- Khuyến nghị dùng `sslmode=verify-full` để giữ hành vi bảo mật hiện tại và hết warning.

Every variable the app reads, with its default, is listed in `.env.example`. A production-style run (postgres + the
Dockerfile `runner` stage) is `docker-compose.yml`.

**Demo add-on: clinic map (not in the ver1 spec).** P01 / P10 clinic lists, P10 clinic page and the P11 clinic step show
an OpenStreetMap map (Leaflet, bundled; no API key, no cookies, no geolocation, no analytics; attribution
「© OpenStreetMap contributors」). Pins come from `clinics.latitude` / `longitude` (nullable; no coordinates → no map, the
`map_url` link stays). The CSP allows `https://tile.openstreetmap.org` in `img-src` only; offline the map is a grey box.

## Run local

```bash
npm install
npm run prisma:generate
npm run dev
```

## Database commands

```bash
npm run prisma:validate
npm run prisma:migrate -- --name init
npm run prisma:migrate:status
npm run prisma:migrate:deploy
npm run prisma:precheck:confirmed-slots
npm run seed
```

`npm run seed` là seed phá hủy dữ liệu hiện có để dựng lại toàn bộ fixture. Khi database đã có dữ liệu, dùng slot feed để bổ sung các slot còn thiếu mà không xóa booking hoặc cập nhật slot đã tồn tại:

```bash
npm run slots:feed -- --dry-run
npm run slots:feed
npm run slots:feed -- --month 2026-11
```

Không nên chỉ chạy theo tháng: hãy chạy `npm run slots:feed` hằng ngày bằng cron trên host có cùng các biến môi trường để duy trì rolling horizon mà API cho phép đặt. Tùy chọn `--month` nạp cả tháng được chọn; API vẫn giới hạn ngày theo `BOOKING_WINDOW_DAYS`, các slot trong ngày đã qua có thể hết hạn, và cache riêng của API là 30 giây.

Ví dụ cron trên host đặt múi giờ UTC, chạy mỗi ngày lúc 00:05 UTC (07:05 giờ Việt Nam; đổi đường dẫn theo host), với thư mục làm việc và environment giống ứng dụng:

```cron
5 0 * * * cd /srv/booking-appointment-system && /usr/bin/npm run slots:feed >> /var/log/booking-slots-feed.log 2>&1
```

## Migration Connectivity

Prisma Migrate nên dùng direct PostgreSQL URL thay vì pooler URL để tránh lỗi `P1017` / `Schema engine error`.

- Runtime app:
  - dùng `DATABASE_URL` (có thể là pooler, ví dụ Supabase `:6543`)
- Migration commands:
  - dùng `POSTGRES_URL_NON_POOLING` (direct connection, thường `:5432`)
  - đã được chuẩn hóa qua scripts `prisma:migrate*`

Flow khuyến nghị trước khi deploy migration:

```bash
npm run prisma:precheck:confirmed-slots
npm run prisma:migrate:status
npm run prisma:migrate:deploy
```

Nếu gặp `P1017: Server has closed the connection`:

1. Kiểm tra `POSTGRES_URL_NON_POOLING` có đang set đúng direct URL không.
2. Chạy `npm run prisma:migrate:status` (không dùng `npx prisma migrate status` trực tiếp).
3. Nếu vẫn lỗi, kiểm tra allowlist/network path từ môi trường chạy lệnh tới DB direct port.

Seed sẽ tạo:

- 12 specialties
- 4 hospitals
- 25 doctors
- ~12,000 slots trong 30 ngày (09:00-17:00, mỗi 30 phút)
- sample bookings cho trạng thái CONFIRMED/CANCELED

## Test

```bash
npm run test
npm run lint
```

## API health

```bash
GET /api/health
```

Response:

```json
{ "status": "ok", "timestamp": "..." }
```

## Deploy vercel on PROD mode
```
npx vercel deploy --prod
```
