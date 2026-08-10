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

Lưu ý TLS cho PostgreSQL hosted:

- Nếu bạn dùng URL có `sslmode=require`, `pg` sẽ cảnh báo về thay đổi semantics ở version lớn tiếp theo.
- Khuyến nghị dùng `sslmode=verify-full` để giữ hành vi bảo mật hiện tại và hết warning.

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
- admin user (`ductv7` / `Admin1234`)
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
