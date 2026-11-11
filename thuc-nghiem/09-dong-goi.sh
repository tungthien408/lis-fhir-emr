#!/usr/bin/env bash
# BƯỚC 09 – ĐÓNG GÓI MINH CHỨNG.
#  - Kiểm tra không có mật khẩu nào lọt vào thư mục kết quả.
#  - Tạo MINH_CHUNG_SHA256.txt: "dấu vân tay" của từng file, để chứng minh số liệu không bị sửa sau khi chạy.
#  - Tắt môi trường thực nghiệm, bật lại stack demo nếu bước 00 đã tạm dừng nó.
#  - Commit thư mục kết quả vào nhánh git riêng trên máy (KHÔNG push).
source "$(dirname "$0")/lib.sh"
step_begin "09-dong-goi" "PACK"

# Tìm mật khẩu bị lộ dưới dạng chuỗi kết nối (":<mật khẩu>@") hoặc dòng biến môi trường ("PASSWORD=<mật khẩu>")
for v in LIS_DB_PASSWORD MIDDLEWARE_DB_PASSWORD EMR_DB_PASSWORD POSTGRES_ADMIN_PASSWORD; do
  val="${!v}"
  hits=$(grep -rlE --exclude='*.gz' -e ":${val}@" -e "PASSWORD=${val}([^A-Za-z0-9]|$)" "$OUT" 2>/dev/null || true)
  if [ -n "$hits" ]; then log "CẢNH BÁO: giá trị của $v xuất hiện trong: $hits → KHÔNG commit, cần xóa/che rồi chạy lại bước 09."; false; fi
done
log "Không thấy mật khẩu trong thư mục kết quả."

# Nén các file thô lớn (> 5 MB) để commit được; gzip giữ nguyên nội dung, giải nén bằng: gunzip <file>.gz
find "$OUT" -type f -size +5M ! -name '*.gz' -print0 | while IFS= read -r -d '' f; do gzip -9 "$f" && log "  đã nén: ${f#$OUT/}.gz"; done

# Không tính các file còn được ghi thêm sau bước này (nhật ký, trạng thái, tiến độ).
(cd "$OUT" && find . -type f ! -name 'MINH_CHUNG_SHA256.txt' ! -name '.isolation-token' ! -name 'nhat-ky-chay.log' \
   ! -name 'TIEN_DO.md' ! -path './trang-thai/*' -print0 | sort -z | xargs -0 sha256sum) > "$OUT/MINH_CHUNG_SHA256.txt"
log "Đã tạo MINH_CHUNG_SHA256.txt ($(wc -l < "$OUT/MINH_CHUNG_SHA256.txt") file). Kiểm tra lại sau này: cd $OUT && sha256sum -c MINH_CHUNG_SHA256.txt"

if [ "${GIU_MOI_TRUONG:-0}" != 1 ]; then
  dcx_all down -v --remove-orphans >/dev/null 2>&1 || true
  log "Đã tắt và xóa môi trường thực nghiệm lisexp (dữ liệu đã được sao lưu trong các file .sql.gz)."
fi
if [ -f "$OUT/trang-thai/stack-demo-da-tam-dung.txt" ]; then
  docker compose -p lis-fhir-emr --project-directory "$ROOT" -f "$ROOT/compose.yaml" start >/dev/null 2>&1 \
    && log "Đã bật lại stack demo của nhóm." || log "Không tự bật lại được stack demo → chạy tay: docker compose up -d"
fi

BR="thuc-nghiem/so-lieu-$RUN_TAG"
cd "$ROOT"
cur=$(git rev-parse --abbrev-ref HEAD)
if [ "$cur" != "$BR" ]; then git checkout -b "$BR" 2>/dev/null || git checkout "$BR"; fi
for f in thuc-nghiem/*.sh thuc-nghiem/*.py thuc-nghiem/*.mjs thuc-nghiem/*.md thuc-nghiem/*.json thuc-nghiem/ket-qua/.run-tag "$OUT"; do
  [ -e "$f" ] && git add -f -- "$f"
done
git reset -q -- "$OUT/.isolation-token" 2>/dev/null || true
if git diff --cached --quiet; then log "Không có gì mới để commit."
else git commit -q -m "Số liệu thực nghiệm chương 3 – đợt $RUN_TAG" && log "Đã commit vào nhánh $BR (chưa push)."; fi
step_end
