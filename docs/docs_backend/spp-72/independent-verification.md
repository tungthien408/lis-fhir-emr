# SPP-72 — Bộ đối chiếu độc lập

Tái sử dụng nguyên bộ SPP-82-C (`backend/scripts/spp82/verification/`), không viết lại. Chi tiết: `docs/docs_backend/spp-82-c-review.md`.

## Ba mốc
| Mốc | Ý nghĩa | Có phải hoàn tất? |
|---|---|---|
| M1 | LIS chấp nhận Publish (202/200) | Không |
| M2 | Middleware `DELIVERED` (Worker tự báo) | Không |
| M3 | EMR lưu, client đọc lại đúng **và** comparator độc lập PASS, bằng chứng thuộc run | Có |

## Phủ yêu cầu R3
| Yêu cầu | Cơ chế trong comparator |
|---|---|
| Mã kết quả, liên kết bệnh nhân | MR01–MR02: tra patient_links theo namespace+value, so UUID đã khóa |
| Số lượng nguồn/đích | mẫu số cố định 1.000; observed/missing/extra theo after − before |
| Giá trị, đơn vị, loại xét nghiệm | MR03–MR06 (Decimal bằng chuỗi/BigInt, không làm tròn) |
| Thời gian, trạng thái, khoảng tham chiếu | MR07–MR09; instant giữ phần lẻ giây |
| Trùng/thiếu/sai | duplicate, missing, field-mismatch, reused-target, stale |
| Đọc lại EMR | đối chiếu cả cột EMR lẫn FHIR lưu tại EMR |

## Tính độc lập của expected
- Expected = `reference/spp65-v2/` (CSV bàn giao + nguồn MIMIC), khóa checksum trước mọi so sánh.
- Thư mục `verification/` không import Mapper, Worker verification, repository hay controller production (đã kiểm ở 82-C).
- Thiếu/sai oracle ⇒ `NOT_VERIFIED`, exit 2; không tự chuyển sang dùng đầu ra hệ thống làm expected.
- Hạn chế: 82-B observer (`measurement-runner`) **tái dùng** `verifyReadBack` của Worker, nên nó không độc lập; chỉ comparator 82-C mới được dùng làm kết luận đúng/sai dữ liệu.
- Hạn chế: bản khóa là khóa cục bộ, chưa có xác nhận chủ sở hữu SPP-65.

## Lệnh tái lập (offline, không gọi DB/Publish)
```bash
cd backend
npm run check
npm run test:spp82
npm run spp82:verify -- --oracle scripts/spp82/reference/spp65-v2/manifest.json \
  --oracle-sha256 55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267 \
  --run-dir <artifact-82b> --before <before.json> --after <after.json> --output <thư-mục-MỚI>
```
Lệnh `spp82:capture` chỉ chạy trong DB cô lập đã được phê duyệt (cần 3 `*_VERIFY_DATABASE_URL` + `SPP82_VERIFICATION_ISOLATION_TOKEN`).
Before phải chụp **trước** run; không thể bổ sung hồi tố.

## Kết quả 1.000/1.000 thực tế
Chưa có: xem `evidence/README.md` (USER_REPORTED_UNVERIFIED).
