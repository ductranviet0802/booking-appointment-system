-- Xóa các bác sĩ dữ liệu hiệu năng có tên dạng "BS. Perf Test <số>".
-- Regex cố ý không phụ thuộc vào specialty được nối ở giao diện (ví dụ: " - Tim mạch").

BEGIN;

-- Lưu cố định ID mục tiêu trong transaction để các bước xem trước và xóa dùng cùng một tập.
CREATE TEMP TABLE perf_test_doctors_to_delete (
  id   uuid PRIMARY KEY,
  name text NOT NULL
) ON COMMIT DROP;

INSERT INTO perf_test_doctors_to_delete (id, name)
SELECT id, name
FROM public.doctors
WHERE name ~ '^BS[.] Perf Test [0-9]+$'
ORDER BY id;

-- Xem tên và ID bác sĩ sẽ bị xóa.
SELECT id, name
FROM perf_test_doctors_to_delete
ORDER BY name, id;

-- Số lượng tại thời điểm truy vấn; có thể thay đổi nếu có ghi đồng thời.
SELECT
  (SELECT COUNT(*) FROM perf_test_doctors_to_delete) AS doctor_count,
  (SELECT COUNT(*)
   FROM public.doctor_slots AS slots
   JOIN perf_test_doctors_to_delete AS targets ON targets.id = slots.doctor_id) AS slot_count,
  (SELECT COUNT(*)
   FROM public.bookings AS bookings
   JOIN public.doctor_slots AS slots ON slots.id = bookings.slot_id
   JOIN perf_test_doctors_to_delete AS targets ON targets.id = slots.doctor_id) AS booking_count;

-- Xóa doctors; doctor_slots và bookings liên quan sẽ được PostgreSQL xóa theo ON DELETE CASCADE.
DELETE FROM public.doctors AS doctors
USING perf_test_doctors_to_delete AS targets
WHERE doctors.id = targets.id
RETURNING doctors.id, doctors.name;

-- COMMIT sẽ ghi nhận việc xóa. Để chạy thử, thay COMMIT bên dưới bằng ROLLBACK.
COMMIT;
