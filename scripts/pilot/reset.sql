-- SPP-73 reset giữa các lượt (chỉ chạy trên DB cô lập đã được người dùng xác nhận 03/11/2026).
-- Chỉ xóa dữ liệu phát sinh từ pilot cho 1.000 kết quả seed; giữ nguyên lis.results, bệnh nhân,
-- catalog, patient_links và dữ liệu DEMO-* có sẵn trước pilot.
BEGIN;
CREATE TEMP TABLE _seed AS SELECT result_id FROM lis.results WHERE provenance->>'seed_tag'='DACN-MIMIC22-SOURCE-ALIGNED-V2';
CREATE TEMP TABLE _ex AS SELECT exchange_id FROM lis.publish_events WHERE result_id IN (SELECT result_id FROM _seed) AND exchange_id IS NOT NULL;
DELETE FROM lis.dispatch_attempts WHERE event_id IN (SELECT event_id FROM lis.publish_events WHERE result_id IN (SELECT result_id FROM _seed));
DELETE FROM integration.exchange_events WHERE exchange_id IN (SELECT exchange_id FROM integration.exchange_transactions WHERE source_result_id IN (SELECT result_id FROM _seed) OR exchange_id IN (SELECT exchange_id FROM _ex));
DELETE FROM integration.exchange_attempts WHERE exchange_id IN (SELECT exchange_id FROM integration.exchange_transactions WHERE source_result_id IN (SELECT result_id FROM _seed) OR exchange_id IN (SELECT exchange_id FROM _ex));
DELETE FROM integration.exchange_transactions WHERE source_result_id IN (SELECT result_id FROM _seed) OR exchange_id IN (SELECT exchange_id FROM _ex);
DELETE FROM emr.lab_results WHERE external_id IN (SELECT result_id FROM _seed);
DELETE FROM lis.publish_events WHERE result_id IN (SELECT result_id FROM _seed);
COMMIT;
