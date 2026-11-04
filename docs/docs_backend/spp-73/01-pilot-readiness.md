# SPP-73 — Mức sẵn sàng pilot (Giai đoạn 1)

Ngày kiểm tra: 03/11/2026. Trạng thái tổng: **BLOCKED** cho pilot chính thức.
Chưa có lần chạy pilot nào. Không có số đo nào trong tài liệu này.

## Điều kiện đầu vào
| Phụ thuộc | Trạng thái | Ghi chú |
|---|---|---|
| P4-03 (SPP-72) | Người kiểm thử chấp nhận, không có log | Xem `docs/docs_backend/spp-72/completion-report.md` |
| P4-01, P4-02 | **NOT_VERIFIED** | Không có tài liệu nghiệm thu trong repository; cần xác nhận từ người phụ trách |
| Môi trường cô lập đã được phê duyệt | **BLOCKED** | Chưa có; không có quyền xác nhận thay |

## Kiểm tra công cụ (kết quả thực tế, 03/11/2026)
| Lệnh | Kết quả | Phân loại |
|---|---|---|
| `cd backend && npm run check` | exit 0 | READY |
| `cd backend && npm run test:spp82` | 111 pass / 0 fail / 0 skip | READY (dữ liệu giả) |
| `npm run spp82:dry-run` không cấu hình | exit 1, thiếu `LIS_BASE_URL` | Đúng thiết kế |
| `LIS_BASE_URL=http://127.0.0.1:3101 npm run spp82:dry-run` | exit 1: `ECONNREFUSED 127.0.0.1:5433` | **BLOCKED** (DB không chạy) |

## Phân loại từng thành phần
| Thành phần | Phân loại | Bằng chứng |
|---|---|---|
| Publish runner 1.000 kết quả (82-A) | READY (mã), chưa chạy thật | `publish-runner.test.ts`, dry-run guard |
| Tuần tự (SEQUENTIAL, c=1) | READY (mã) | Test A04 |
| Đồng thời (CONCURRENT, c≤10) | READY (mã), **giới hạn ở HTTP Publish** | Xem `02-pilot-test-matrix.md` |
| Theo dõi tới EMR (82-B) | READY (mã), opt-in `SPP82_MEASURE=1` | 24 test B |
| Đối chiếu nguồn–đích (82-C) | READY (mã), cần DB cô lập để capture | 40 test C; `spp82:verify` offline |
| Đo thời gian và log | READY (mã) | `metrics.json`, `run-manifest.json` |
| Reset môi trường | **MISSING** | Không có script reset; không tự viết (cần phê duyệt) |
| Nạp dữ liệu seed | READY (tài liệu) | `database/seed/` do Docker init; nạp thủ công theo `database/seed/README.md` |
| Khởi chạy LIS/Dispatcher/Middleware/Worker/EMR | PARTIAL | Có npm scripts; chưa chạy trong phiên này |

## Thiếu sót cụ thể (không sửa code trong giai đoạn này)
1. Không có lệnh reset có kiểm soát. Quy trình hiện là thủ công (xem `03-environment-checklist.md`).
2. Dispatcher và Worker xử lý **một bản ghi mỗi vòng `runOnce`** (`src/lis/dispatcher.ts:103`, `src/middleware/worker.ts:78`). Song song phía sau chỉ có khi chạy nhiều process (SKIP LOCKED). Chưa có cấu hình số process mặc định.
3. Chưa có giá trị timeout chạy 1.000 kết quả: `SPP82_RUN_TIMEOUT_MS` mặc định 120.000 ms, không đủ cho tuần tự. Phải đặt theo pilot nhỏ, không ước lượng.
4. Chưa chạy được `spp82:dry-run` thật vì DB và dịch vụ chưa có.

Không sửa mã, không reset, không Publish. Hạng mục 1–3 đề xuất để SPP-73 giai đoạn 2 quyết định.
