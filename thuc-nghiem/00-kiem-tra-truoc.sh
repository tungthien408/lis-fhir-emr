#!/usr/bin/env bash
# BƯỚC 00 – KIỂM TRA TRƯỚC KHI CHẠY. An toàn, có thể chạy lại bao nhiêu lần cũng được.
# - Kiểm tra đủ công cụ, Docker dùng được, file .env hợp lệ, đủ dung lượng đĩa.
# - Tạm dừng stack demo của nhóm (chỉ "stop", KHÔNG xóa dữ liệu) để nhường cổng 3101–3103, 5433.
# - Ghi lại cấu hình máy + phiên bản code vào ket-qua/<ngày>/00-moi-truong.txt
source "$(dirname "$0")/lib.sh"
step_begin "00-kiem-tra-truoc" "PRE"
fail=0
need() { if command -v "$1" >/dev/null 2>&1; then log "  có $1"; else log "  THIẾU $1 → $2"; fail=1; fi; }
want() { if command -v "$1" >/dev/null 2>&1; then log "  có $1"; else log "  (không bắt buộc) thiếu $1 → $2"; fi; }

log "Kiểm tra công cụ:"
need docker "cài Docker Engine"; need node "cài Node.js >= 22.16"; need npm "cài npm"; need jq "sudo pacman -S jq"
need curl "sudo pacman -S curl"; need gzip "sudo pacman -S gzip"; need sha256sum "coreutils"
want java "sudo pacman -S jre-openjdk (cần cho bước 07 kiểm tra FHIR)"
want python3 "sudo pacman -S python (cần cho bước 08 tổng hợp)"
python3 -c 'import matplotlib' 2>/dev/null && log "  có matplotlib" || log "  (không bắt buộc) thiếu matplotlib → sudo pacman -S python-matplotlib (để vẽ biểu đồ)"

node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=16)?0:1)' \
  || { log "  Node.js cần >= 22.16 (đang là $(node -v))"; fail=1; }
docker info >/dev/null 2>&1 || { log "  Không gọi được Docker không cần sudo (thêm user vào nhóm docker, đăng nhập lại)"; fail=1; }
docker image inspect postgres:17 >/dev/null 2>&1 || { log "  Chưa có image postgres:17 → đang tải…"; docker pull postgres:17 >/dev/null || fail=1; }

log "Kiểm tra .env:"
for v in LIS_DB_PASSWORD MIDDLEWARE_DB_PASSWORD EMR_DB_PASSWORD POSTGRES_ADMIN_PASSWORD; do
  val="${!v:-}"
  if [ -z "$val" ] || [ "$val" = CHANGE_ME ]; then log "  $v chưa đặt"; fail=1
  elif ! [[ "$val" =~ ^[A-Za-z0-9]+$ ]]; then log "  $v chỉ nên gồm chữ và số (đang có ký tự đặc biệt)"; fail=1
  else log "  $v: ok"; fi
done

avail=$(df -Pk "$ROOT" | awk 'NR==2{print int($4/1024/1024)}')
[ "$avail" -ge 3 ] && log "Đĩa trống: ${avail} GB" || { log "Đĩa trống chỉ còn ${avail} GB (cần >= 3 GB)"; fail=1; }

log "Tạm dừng stack demo của nhóm (nếu đang chạy) – dữ liệu demo được giữ nguyên:"
if [ -n "$(docker compose -p lis-fhir-emr --project-directory "$ROOT" -f "$ROOT/compose.yaml" ps -q 2>/dev/null)" ]; then
  docker compose -p lis-fhir-emr --project-directory "$ROOT" -f "$ROOT/compose.yaml" --profile dispatcher --profile worker stop >/dev/null
  echo "Stack demo (project lis-fhir-emr) đã được TẠM DỪNG lúc $(now_iso). Bật lại: docker compose up -d" > "$OUT/trang-thai/stack-demo-da-tam-dung.txt"
  log "  đã tạm dừng (bật lại ở bước 09)"
else log "  stack demo không chạy"; fi
for p in 3101 3102 3103 5433; do
  if (exec 3<>/dev/tcp/127.0.0.1/$p) 2>/dev/null; then
    owner=$(docker ps --format '{{.Names}} {{.Ports}}' | grep ":$p->" | awk '{print $1}' || true)
    if [[ "$owner" == lisexp-* ]]; then log "  cổng $p đang do môi trường thực nghiệm dùng (ok)"; else log "  cổng $p đang bị chiếm bởi: ${owner:-tiến trình ngoài Docker}"; fail=1; fi
  fi
done

log "Chuẩn bị thư viện Node của backend:"
if [ ! -d "$BACKEND/node_modules" ]; then (cd "$BACKEND" && npm ci >/dev/null 2>&1) && log "  đã npm ci" || { log "  npm ci lỗi"; fail=1; }
else log "  node_modules đã có"; fi

{
  echo "Thời điểm ghi: $(now_iso)"
  echo "Commit đang chạy: $(git -C "$ROOT" rev-parse HEAD) (nhánh $(git -C "$ROOT" rev-parse --abbrev-ref HEAD))"
  echo "Code có sửa chưa commit?: $(git -C "$ROOT" status --porcelain -- backend database compose.yaml | wc -l | tr -d ' ') file"
  echo "Hệ điều hành: $(uname -srm)"
  echo "CPU: $(lscpu 2>/dev/null | sed -n 's/^Model name:[[:space:]]*//p' | head -1), $(nproc) luồng"
  echo "RAM: $(free -h | awk '/^Mem:/{print $2}')"
  echo "Node: $(node -v) | npm: $(npm -v)"
  echo "Docker: $(docker --version) | $(docker compose version)"
  echo "PostgreSQL (image): postgres:17"
  echo "Java: $(java -version 2>&1 | grep -i 'version' | head -1 || echo 'không có')"
  echo "Cấu hình hệ thống khi đo (mặc định trong compose.yaml): chờ HTTP 3 s; thử lại sau 2 s, 4 s, 8 s (tối đa 4 lần);"
  echo "  giữ việc (lease) 15 s; quét hàng đợi mỗi 1 s; LIS và middleware mỗi bên 1 tiến trình xử lý nền."
} > "$OUT/00-moi-truong.txt"
log "Đã ghi cấu hình máy vào 00-moi-truong.txt"

[ "$fail" = 0 ] || { log "CÒN MỤC CHƯA ĐẠT ở trên → sửa rồi chạy lại bước 00."; false; }
check PRE "PRE-OK" "Kiểm tra trước khi chạy" "đạt" "đạt"
step_end
