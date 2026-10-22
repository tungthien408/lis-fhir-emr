-- Dùng SAU KHI tạo dacn_db và chạy dacn_db_init_v2.sql.
-- Chạy bằng tài khoản quản trị/owner trong Query Tool của database dacn_db.
-- Script KHÔNG lưu password. Sau khi chạy, đặt password cho từng role trong pgAdmin:
-- Login/Group Roles -> tên role -> Properties -> Definition -> Password -> Save.
-- Các role không thể đăng nhập qua mạng dùng password cho đến khi bạn đặt password.

BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'dacn_db' THEN
    RAISE EXCEPTION 'Phai chay tren dacn_db, hien tai: %', current_database();
  END IF;
END $guard$;

DO $create_roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'lis_app') THEN
    CREATE ROLE lis_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'integration_app') THEN
    CREATE ROLE integration_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'emr_app') THEN
    CREATE ROLE emr_app LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'evaluator_app') THEN
    CREATE ROLE evaluator_app LOGIN;
  END IF;
END $create_roles$;

GRANT CONNECT ON DATABASE dacn_db TO lis_app, integration_app, emr_app, evaluator_app;

GRANT USAGE ON SCHEMA lis TO lis_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA lis TO lis_app;

GRANT USAGE ON SCHEMA integration TO integration_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  integration.exchange_transactions,
  integration.exchange_attempts,
  integration.exchange_events
TO integration_app;
-- Middleware KHÔNG có quyền ghi hai bảng đánh giá dưới đây.

GRANT USAGE ON SCHEMA emr TO emr_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA emr TO emr_app;

-- Evaluator đọc dữ liệu 3 hệ thống và ghi kết quả vào bảng đánh giá riêng.
GRANT USAGE ON SCHEMA lis, integration, emr TO evaluator_app;
GRANT SELECT ON ALL TABLES IN SCHEMA lis, integration, emr TO evaluator_app;
GRANT INSERT, UPDATE, DELETE ON
  integration.experiment_runs,
  integration.field_comparisons
TO evaluator_app;

COMMIT;

-- Lưu ý: script chỉ CẤP các quyền trên, không thu hồi quyền cũ của role đã tồn tại.
-- Nếu các role trước đó đã được cấp quyền rộng, cần kiểm toán và thu hồi riêng.
-- Nếu về sau có bảng mới, cần cấp quyền tương ứng cho bảng đó.
