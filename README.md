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

### Playwright E2E

```bash
npx playwright install chromium firefox webkit
npm run test:e2e
npm run test:e2e:report
```

Bộ E2E chạy trên Chromium, Firefox, WebKit và Mobile Chrome. Mỗi lần chạy tự khởi tạo PostgreSQL tạm trên localhost, áp dụng migrations, tạo dữ liệu mẫu và khởi động ứng dụng ở cổng `3217`. Các thao tác đăng ký, đặt và hủy lịch đi qua API thật trên database tạm này; `DATABASE_URL` của môi trường không được dùng. Database tạm được dừng và xóa khi server kiểm thử kết thúc. Cần để cổng `3217` trống hoặc đặt `E2E_PORT` sang cổng khác.

Kiểm thử bao gồm tìm kiếm/bộ lọc, xác thực, toàn bộ vòng đời booking, trạng thái lỗi API và bố cục ở các chiều rộng 390/768/1440px. Mock chỉ dùng cho các trạng thái lỗi/loading; luồng booking thành công sử dụng API và database thật. Screenshot, video và trace được lưu trong `test-results/` khi lỗi; báo cáo HTML ở `playwright-report/`. Ảnh kiểm tra bố cục được lưu cùng kết quả test, không dùng giao diện cũ làm chuẩn pixel cho thiết kế mới.

Chạy riêng một trình duyệt:

```bash
npm run test:e2e -- --project=chromium
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
