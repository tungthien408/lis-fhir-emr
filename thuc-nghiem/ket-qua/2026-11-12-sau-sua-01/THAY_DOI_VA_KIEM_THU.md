# Bản sửa và kiểm thử

Bản sửa chưa commit; fingerprint từng file có trong `run-manifest.json`.

## Kiểm thử

- PostgreSQL cuối đợt: 522/522, bỏ qua 0.
- SPP82: 114/114; ops: 13/13; frontend: 92/92.
- Backend check, frontend check/build và hai test shell: PASS.
- Chrome thật trên ba entrypoint: PASS; chỉ GET.
- Probe năm ca trên mã nền: tất cả valid; trên mã sửa: tất cả invalid. Hai test hồi quy âm trên mã nền trả exit khác 0 như kỳ vọng. Mỗi phiên probe dùng fixture/namespace của hợp đồng tương ứng.
- Toàn bộ 1136 file bằng chứng cũ/tham chiếu v2 giữ nguyên; 170 file nguồn trong manifest không đổi trong suốt lượt đo.

## Các file sửa hoặc bổ sung

- `backend/scripts/spp82/measurement.test.ts`
- `backend/scripts/spp82/reference/spp65-v3/expected.jsonl`
- `backend/scripts/spp82/reference/spp65-v3/manifest.json`
- `backend/scripts/spp82/reference/spp65-v3/manifest.sha256`
- `backend/scripts/spp82/reference/spp65-v3/patient-links.json`
- `backend/scripts/spp82/reference/spp65-v3/rules.json`
- `backend/scripts/spp82/reference/spp65-v3/upstream-answers.csv`
- `backend/scripts/spp82/verification/expected-loader.ts`
- `backend/scripts/spp82/verification/freeze-reference-v3.py`
- `backend/scripts/spp82/verification/reference-v3.test.ts`
- `backend/scripts/spp82/verification/synthetic-fixtures.ts`
- `backend/src/common/fhir-namespaces.ts`
- `backend/src/common/test-catalog.ts`
- `backend/src/emr/service.ts`
- `backend/src/middleware/mapper.ts`
- `backend/src/middleware/monitor-diagnostics.ts`
- `backend/src/middleware/service.ts`
- `backend/tests/e2e/d3-fixtures.ts`
- `backend/tests/e2e/d3-harness.ts`
- `backend/tests/e2e/fixtures/d3-synthetic.json`
- `backend/tests/e2e/lis-emr.e2e.test.ts`
- `backend/tests/e2e/publish-browser-server.ts`
- `backend/tests/emr/catalog-regression.test.ts`
- `backend/tests/emr/controller.http.test.ts`
- `backend/tests/emr/controller.integration.test.ts`
- `backend/tests/emr/fixtures.ts`
- `backend/tests/emr/repository.integration.test.ts`
- `backend/tests/emr/service.integration.test.ts`
- `backend/tests/emr/service.unit.test.ts`
- `backend/tests/integration/c4-harness.ts`
- `backend/tests/integration/fixtures/c4-synthetic.json`
- `backend/tests/integration/middleware-emr.integration.test.ts`
- `backend/tests/middleware/catalog-regression.test.ts`
- `backend/tests/middleware/controller.http.test.ts`
- `backend/tests/middleware/controller.integration.test.ts`
- `backend/tests/middleware/exchange-contract.test.ts`
- `backend/tests/middleware/fixtures.ts`
- `backend/tests/middleware/fixtures/observation-r4-golden.json`
- `backend/tests/middleware/mapper.test.ts`
- `backend/tests/middleware/monitor-diagnostics.test.ts`
- `backend/tests/middleware/service.integration.test.ts`
- `backend/tests/middleware/worker.integration.test.ts`
- `database/dacn_db_init_v2.sql`
- `database/seed/01_reference_data.sql`
- `docs/api-contract.md`
- `frontend/apps/emr/src/types/emr.ts`
- `frontend/apps/emr/tests/fixtures.mjs`
- `frontend/apps/lis/tests/flow-fixtures.mjs`
- `frontend/apps/middleware-monitor/tests/fixtures.mjs`
- `thuc-nghiem/00-kiem-tra-truoc.sh`
- `thuc-nghiem/01-test-tu-dong.sh`
- `thuc-nghiem/04-E2-sai-benh-nhan-du-lieu-sai.sh`
- `thuc-nghiem/07-kiem-tra-fhir.sh`
- `thuc-nghiem/09-dong-goi.sh`
- `thuc-nghiem/HUONG_DAN_CHO_CLAUDE_CODE.md`
- `thuc-nghiem/README.md`
- `thuc-nghiem/checks-store.sh`
- `thuc-nghiem/lib.sh`
- `thuc-nghiem/test-log.sh`
- `thuc-nghiem/tests/checks-store.test.sh`
- `thuc-nghiem/tests/test-log.test.sh`
- `thuc-nghiem/write-run-manifest.py`

## Lệnh đã kiểm tra

```bash
cd backend
npm run check
npm run test:repositories:postgres
npm run test:integration:postgres
npm run test:spp82
npm run test:ops
cd ../frontend
npm run check
npm run build
npm run test --workspaces
cd ..
bash thuc-nghiem/tests/checks-store.test.sh
bash thuc-nghiem/tests/test-log.test.sh
```

Các phép đo được chạy riêng, theo chuỗi 00 → 02 → 03 → 04 → kiểm tra Chrome → 05 → 06 → 01/07 song song → 08. Đóng gói dùng PACK_GIT=0. Không commit/push, không di trú DB demo cũ.
