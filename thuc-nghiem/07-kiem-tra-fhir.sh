#!/usr/bin/env bash
# BƯỚC 07 – KIỂM TRA CẤU TRÚC FHIR (M8) bằng công cụ kiểm tra chính thức của HL7 (validator_cli.jar).
# Kiểm tra 1.000 bản Observation đã xuất ở bước 02 có đúng chuẩn FHIR R4 (4.0.1) hay không.
# Lần đầu cần Internet để tải công cụ (~200 MB) và gói định nghĩa FHIR R4. Thời gian: 5–30 phút.
# Lưu ý: "warning" về hệ mã https://example.org/... là bình thường (nhóm dùng mã cục bộ, chưa dùng LOINC),
#        chỉ "error"/"fatal" mới tính là không đạt.
source "$(dirname "$0")/lib.sh"
require_step "02-E1-1000-ket-qua"
step_begin "07-kiem-tra-fhir" "FHIR"
D="$OUT/kiem-tra-fhir"; rm -rf "$D"; mkdir -p "$D"
S=FHIR
command -v java >/dev/null || { log "Thiếu Java (sudo pacman -S jre-openjdk)"; false; }
JAR="${VALIDATOR_JAR:-$HOME/.cache/lis-fhir-emr/validator_cli.jar}"
if [ ! -s "$JAR" ]; then
  mkdir -p "$(dirname "$JAR")"; log "Tải validator_cli.jar…"
  curl -fsSL -o "$JAR" https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar
fi
java -jar "$JAR" -version > "$D/phien-ban-cong-cu.txt" 2>&1 || true
n_files=$(ls "$OUT/fhir-1000"/*.json | wc -l | tr -d ' ')
log "Kiểm tra $n_files bản FHIR (có thể mất 5–30 phút)…"
# VALIDATOR_TX: để trống = dùng máy chủ thuật ngữ mặc định của HL7 (cần Internet); đặt "n/a" để bỏ kiểm tra thuật ngữ.
TX_ARGS=(); [ -n "${VALIDATOR_TX:-}" ] && TX_ARGS=(-tx "$VALIDATOR_TX")
rc=0
java -Xmx3g -jar "$JAR" "$OUT"/fhir-1000/*.json -version 4.0.1 "${TX_ARGS[@]}" -output "$D/ket-qua-validator.json" \
  > "$D/log-validator.txt" 2>&1 || rc=$?
echo "mã thoát: $rc" >> "$D/log-validator.txt"

# Phiên bản validator này KHÔNG in dòng "Success/FAILURE" cho từng file; kết quả nằm trong ket-qua-validator.json
# (mỗi file = 1 OperationOutcome). Đếm từ file JSON đó (sửa cách đếm, ghi trong TIEN_DO.md).
read -r n_seen n_ok n_fail < <(python3 -I - "$D/ket-qua-validator.json" <<'PY'
import json, sys
e = json.load(open(sys.argv[1])).get("entry", [])
bad = sum(1 for x in e if any(i.get("severity") in ("error", "fatal") for i in x["resource"].get("issue", [])))
print(len(e), len(e) - bad, bad)
PY
)
{ echo "Số file kiểm tra: $n_files"; echo "Số file công cụ báo kết quả: $n_seen"
  echo "Đạt (0 lỗi): $n_ok"; echo "Không đạt (có lỗi): $n_fail"
  python3 -I - "$D/ket-qua-validator.json" <<'PY'
import json, sys
from collections import Counter
e = json.load(open(sys.argv[1])).get("entry", [])
ce, cw = Counter(), Counter()
for x in e:
    for i in x["resource"].get("issue", []):
        t = (i.get("details") or {}).get("text", "")
        t = __import__("re").sub(r"\d{4}-\d\d-\d\dT[\d:.]+Z", "<thời điểm>", t)
        loc = (i.get("location") or i.get("expression") or [""])[0]
        k = f"{loc}: {t}"[:200]
        if i.get("severity") in ("error", "fatal"): ce[k] += 1
        elif i.get("severity") == "warning": cw[k] += 1
print("\nCác loại lỗi (error/fatal) gặp nhiều nhất (số lượt: loại lỗi):")
for k, v in ce.most_common(15): print(f"{v:6d}  {k}")
print("\nCác loại cảnh báo (warning) gặp nhiều nhất:")
for k, v in cw.most_common(10): print(f"{v:6d}  {k}")
PY
} > "$D/tom-tat.txt"
cat "$D/tom-tat.txt" >&2
if [ "$n_seen" != "$n_files" ]; then
  check $S "FHIR-DOC" "Công cụ kiểm tra đọc được kết quả của tất cả file" "$n_files" "$n_seen"
fi
check $S "FHIR-M8" "Số bản FHIR Observation không có lỗi cấu trúc (theo HL7 validator)" "$n_files" "$n_ok"
step_end
