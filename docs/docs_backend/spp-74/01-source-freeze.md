# SPP-74 — Chốt phiên bản mã nguồn

Written for: người chạy thực nghiệm SPP-75 và người kiểm chéo.

Ngày kiểm tra: 04/11/2026. Mọi giá trị dưới đây đọc từ repository và máy thật.

## 1. Kết luận

Mã nguồn dùng trong pilot SPP-73 **giống hệt** mã nguồn đã commit hiện tại, trong phạm vi hash `source_tree_sha256` (xem mục 3). Người khác có thể lấy lại đúng phiên bản từ Git.

| Mục | Giá trị |
|---|---|
| Nhánh | `testing/spp-74` (cục bộ, chưa push) |
| Commit chứa mã pilot | `e0c971766c2a56a2348b00622def31e5e300be6f` (nhánh `testing/spp-73`, do người dùng commit 04/11/2026 01:20 +0700; đã có trên `origin/testing/spp-73`) |
| Commit SPP-74 (script, đính chính tài liệu) | `fdb9738fc960184464ee2944107d74227ba3148b` |
| Tag | `spp74-experiment-v1` — tạo trên commit cuối của SPP-74 (commit chứa các tài liệu này). Lấy commit: `git rev-parse spp74-experiment-v1^{commit}`. Tag chỉ ở máy cục bộ, **chưa push** |
| HEAD pilot ghi trong bằng chứng | `763da66` + thay đổi chưa commit (nay đã nằm trong `e0c9717`) |

## 2. Phân loại thay đổi trước khi chốt

Trạng thái đầu phiên SPP-74: working tree sạch (`git status` rỗng), đang ở nhánh `testing/spp-73`.

| Nhóm | Nội dung | Đã commit tại |
|---|---|---|
| Mã công cụ đo và đối chiếu SPP-82 | `backend/scripts/spp82/**`, gồm oracle `reference/spp65-v2` | `e0c9717` |
| Công cụ gửi lại `FAILED` | `backend/scripts/ops/requeue-failed.ts` (+ test) | `e0c9717` |
| `backend/package.json`, `tsconfig.test.json` | Thêm script `spp82:*`, `ops:requeue-failed`, `test:ops` | `e0c9717` |
| Tài liệu SPP-72, SPP-73 | `docs/docs_backend/spp-72/`, `spp-73/` | `e0c9717` |
| Script pilot | `scripts/pilot/reset.sql`, `run-all.sh`, `run-scenario.sh` (bản dùng ở pilot, đường dẫn tuyệt đối) | `e0c9717` |
| Script pilot, bản di động | Thay đường dẫn tuyệt đối bằng biến môi trường; thêm kiểm guard trước reset | `fdb9738` |
| `preflight.sh`, `pilot.env.example`, tài liệu SPP-74 | Kiểm trước mỗi lượt; tên biến môi trường | commit cuối (tag) |
| Bằng chứng pilot (~3,9 GB) | `docs/docs_backend/spp-73/pilot-evidence/` | **Không commit.** `.gitignore` dòng 16 |
| `.env`, `node_modules/`, `dist/`, `.venv/` | Cấu hình cá nhân, sản phẩm build | Bị `.gitignore` |

Không còn file chưa theo dõi hay thay đổi chưa commit trong các thư mục mã nguồn.

## 3. So sánh với phiên bản dùng trong pilot

`source_tree_sha256` do `run-all.sh` ghi cho mỗi lượt, tính bằng:
```bash
git ls-files -co --exclude-standard backend/src backend/scripts database | sort | xargs sha256sum | sha256sum | cut -d' ' -f1
```
Phạm vi: 70 file trong `backend/src`, `backend/scripts`, `database`.

| Nguồn | Giá trị | Cách có |
|---|---|---|
| Pilot, 6 lượt (`final/A1…B3/code-and-environment.txt`) | `49e9ebcb66b099760e2b8a6431a01bff66a5e1bbc774cb8ca02213f89cd14e2e` | Đọc từ bằng chứng |
| Working tree trước khi sửa (đầu SPP-74) | `49e9ebcb66b099760e2b8a6431a01bff66a5e1bbc774cb8ca02213f89cd14e2e` | Tính lại 04/11/2026 |
| `git archive e0c9717` giải nén sạch | `49e9ebcb66b099760e2b8a6431a01bff66a5e1bbc774cb8ca02213f89cd14e2e` | Tính lại (70 file khớp 70 file Git) |
| `git clone` + checkout `fdb9738` | `49e9ebcb66b099760e2b8a6431a01bff66a5e1bbc774cb8ca02213f89cd14e2e` | Ghi trong `code-and-environment.txt` của lượt tái lập |

**Kết quả: 4/4 giá trị trùng nhau.** Thay đổi của SPP-74 không chạm `backend/src`, `backend/scripts`, `database`, nên không ảnh hưởng kết quả kiểm thử đã có.

### Giới hạn của hash này (cần biết)

1. Hash **không** bao gồm các file sau, nên chúng được ghi hash riêng ở [02-data-manifest.md](02-data-manifest.md) và [03-environment-manifest.md](03-environment-manifest.md): `backend/package.json`, `backend/package-lock.json`, `backend/tsconfig*.json`, `backend/Dockerfile`, `compose.yaml`, `.env.example`, `scripts/pilot/*`.
2. Việc `sort` phụ thuộc locale. Hash đã tái lập trên cùng máy, cùng locale. Trên máy khác với locale khác, thứ tự file có thể đổi và hash khác dù nội dung giống (đã gặp thứ tự `worker.ts` khác nhau khi so sánh với bên trong container). So sánh khác môi trường: dùng so sánh từng file như ở mục 4.
3. Ba container LIS, Middleware, EMR chạy từ image `lis-fhir-emr-backend:local`, không từ working tree. Xem mục 4.

## 4. Image Docker so với mã nguồn

Image `lis-fhir-emr-backend:local` (ID `sha256:bf9c57ed1a58c104c8c58d80a8d22951baba1f3082e2726c499fe2617b75bcad`, tạo 2026-11-03T14:40:14+07:00) đang chạy 3 container LIS, Middleware, EMR.

Đã so sánh hash từng file của 32 file `src/` trong image với `backend/src/` của repository: **khớp 32/32**. `package-lock.json` trong image cũng khớp (`524842e3…0466`). Cách làm:
```bash
docker run --rm --entrypoint sh lis-fhir-emr-backend:local -c 'cd /app && find src -type f | sort | xargs sha256sum' | sort -k2 > /tmp/img.sha
(cd backend && find src -type f | sort | xargs sha256sum) | sort -k2 > /tmp/host.sha && diff /tmp/host.sha /tmp/img.sha && echo KHỚP
```
**Chưa kiểm chứng:** dựng lại image từ `Dockerfile` ra cùng ID. Dockerfile dùng tag trôi `node:22` (chạy thật: Node v22.23.4), nên hai lần build ở thời điểm khác nhau có thể cho image khác. Xem [08-spp75-handoff.md](08-spp75-handoff.md).

## 5. Kiểm tra trước khi commit/tag

| Kiểm tra | Kết quả | Cách |
|---|---|---|
| Sửa lỗi đã nằm trong mã | Có: DEF-02 (`report-writer.ts`), DEF-03 (`evidence-loader.ts`), `requeue-failed.ts` | `git show e0c9717 --stat` |
| Không có mật khẩu/secret trong file được Git theo dõi | Không phát hiện. Chỉ có giá trị giữ chỗ (`CHANGE_ME`, `secret@` trong test) | Quét `git ls-files` bằng `grep` (mẫu URL kết nối có mật khẩu, khóa riêng, token) |
| `.env` không được theo dõi | Đúng: chỉ `.env.example` được theo dõi | `git ls-files \| grep env` |
| Không có log/dữ liệu lớn trong Git | Đúng: file lớn nhất ngoài `datasets/` là `database/seed/02_lis_results.sql` (848 KB). `datasets/` tổng 16 MB, đã có từ trước | `du -b` trên `git ls-files` |
| `pilot-evidence/` (3,9 GB) không vào Git | Đúng: `git check-ignore -v` trả `.gitignore:16` | |
| Không có file tạm thừa | Không có | `git status --short` |

Kiểm tra mã trên **checkout sạch** (`git clone` + `npm ci`, commit `fdb9738`):

| Lệnh (từ `backend/`) | Kết quả |
|---|---|
| `npm run check` | exit 0 |
| `npm run test:spp82` | 112/112 pass |
| `npm run test:ops` | 13/13 pass |

Các suite `test:e2e:postgres`, `test:integration:postgres`, `test:repositories:postgres` **không chạy lại** ở SPP-74 vì không đổi mã trong `backend/src`. Kết quả của SPP-73 vẫn là bằng chứng: `pilot-evidence/fault-tests/`.

## 6. Tag và push

- Tag `spp74-experiment-v1` chưa tồn tại trước SPP-74 (`git tag` rỗng). Không ghi đè tag nào.
- Không push nhánh hay tag. Lệnh để người phụ trách tự chạy khi đồng ý: `git push origin testing/spp-74 spp74-experiment-v1`.
- Nhận lại đúng phiên bản: `git fetch --tags && git checkout spp74-experiment-v1`.
