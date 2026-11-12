#!/usr/bin/env python3
"""BƯỚC 08 – TỔNG HỢP SỐ LIỆU (tự động, chỉ đọc file kết quả, không chạm DB).

Đọc mọi thứ trong thuc-nghiem/ket-qua/<ngày>/ và sinh ra:
  - chi-so.json            : giá trị M1–M13 dạng máy đọc được
  - TONG_HOP_SO_LIEU.md    : bảng số liệu + bảng kiểm tra từng ca + danh mục minh chứng (KHÔNG sửa tay)
  - bieu-do/*.png          : biểu đồ dùng cho chương 3 (cần matplotlib; thiếu thì bỏ qua)
Chạy: python3 thuc-nghiem/08-tong-hop.py
"""
import csv, json, math, os, statistics, sys
from collections import Counter, defaultdict
from pathlib import Path

TN = Path(__file__).resolve().parent
tag = os.environ.get("RUN_TAG") or (TN / "ket-qua" / ".run-tag").read_text().strip()
OUT = TN / "ket-qua" / tag
if not OUT.is_dir():
    sys.exit(f"Không thấy thư mục kết quả {OUT}")

def p(*parts): return OUT.joinpath(*parts)
import gzip
def open_text(path):
    """Mở file văn bản; nếu đã bị nén ở bước 09 (.gz) thì đọc bản nén."""
    path = Path(path)
    if path.exists(): return open(path)
    gz = Path(str(path) + ".gz")
    if gz.exists(): return gzip.open(gz, "rt")
    return None
def read_json(path, default=None):
    try: return json.loads(Path(path).read_text())
    except Exception: return default
def read_csv(path):
    try:
        with open(path, newline="") as f: return list(csv.DictReader(f))
    except FileNotFoundError: return []
def nums(rows, col):
    out = []
    for r in rows:
        try:
            v = float(r.get(col, ""))
            if not math.isnan(v): out.append(v)
        except (TypeError, ValueError): pass
    return out
def pct(values, q):  # nearest-rank, giống công cụ đo của repo
    if not values: return None
    s = sorted(values); return s[max(0, math.ceil(q * len(s)) - 1)]
def fmt_ms(v):
    if v is None: return "—"
    return f"{v/1000:.2f} s" if v >= 1000 else (f"{v:.1f} ms" if v >= 1 else f"{v:.3f} ms")
def ratio(a, b): return f"{a}/{b} ({100*a/b:.1f}%)" if b else "—"

# ---------------- Các phép kiểm tra "kỳ vọng ↔ thực tế" ----------------
checks = []
if p("kiem-tra.jsonl").exists():
    for line in p("kiem-tra.jsonl").read_text().splitlines():
        if line.strip(): checks.append(json.loads(line))
by_scen = defaultdict(list)
for c in checks: by_scen[c["kich_ban"]].append(c)
def ck(code):
    for c in checks:
        if c["ma"] == code: return c
    return None
def cks(prefix): return [c for c in checks if c["ma"].startswith(prefix)]
def passed(lst): return sum(1 for c in lst if c["ket_qua"] == "DAT")

metrics = {}
notes = {}

# ---------------- E1: 1.000 kết quả ----------------
E1 = p("E1-1000-ket-qua")
rep = read_json(E1 / "doi-chieu" / "comparison-report.json", {}) or {}
mtr = read_json(E1 / "do-luong" / "metrics.json", {}) or {}
core40 = set(p("danh-sach-40-ket-qua-loi.txt").read_text().split()) if p("danh-sach-40-ket-qua-loi.txt").exists() else set()

field_rows = []   # chỉ các trường MR01–MR09
f = open_text(E1 / "doi-chieu" / "field-comparisons.jsonl")
if f:
    with f:
        for line in f:
            r = json.loads(line)
            if (r.get("rule_id") or "").startswith("MR") and r.get("result_id"):
                field_rows.append(r)

def m2_m3(rows):
    ok = sum(1 for r in rows if r["outcome"] == "PASS"); bad = sum(1 for r in rows if r["outcome"] == "FAIL")
    na = lambda v: isinstance(v, dict) and v.get("not_applicable")
    need = [r for r in rows if r.get("expected") is not None and not na(r.get("actual_target"))]
    present = sum(1 for r in need if r.get("actual_target") is not None)
    return ok, ok + bad, present, len(need)

per_res = {}
f = open_text(E1 / "doi-chieu" / "per-result-verification.jsonl")
if f:
    with f: lines = f.read().splitlines()
    for line in lines:
        r = json.loads(line)
        if r.get("result_id"): per_res[r["result_id"]] = r["outcome"]

if rep:
    n_total = rep.get("total_expected_results", 1000)
    ok_all, tot_all, pres_all, need_all = m2_m3(field_rows)
    rows40 = [r for r in field_rows if r["result_id"] in core40]
    ok40, tot40, pres40, need40 = m2_m3(rows40)
    pass40 = sum(1 for k in core40 if per_res.get(k) == "PASS")
    metrics["M1"] = {"ten": "Tỷ lệ hoàn tất đầu–cuối (lưu đúng, đúng bệnh nhân, đọc lại được)",
                     "1000": ratio(rep.get("matched_result_count", 0), n_total), "40_loi": ratio(pass40, len(core40) or 40),
                     "nguon": "E1-1000-ket-qua/doi-chieu/comparison-report.json"}
    metrics["M2"] = {"ten": "Độ chính xác theo trường (MR01–MR09)", "1000": ratio(ok_all, tot_all), "40_loi": ratio(ok40, tot40),
                     "nguon": "E1-1000-ket-qua/doi-chieu/field-comparisons.jsonl"}
    metrics["M3"] = {"ten": "Tính đầy đủ (trường phải có thì có mặt ở EMR)", "1000": ratio(pres_all, need_all), "40_loi": ratio(pres40, need40),
                     "nguon": "E1-1000-ket-qua/doi-chieu/field-comparisons.jsonl"}
    metrics["M4"] = {"ten": "Số kết quả gắn sai bệnh nhân", "1000": str(rep.get("wrong_patient_linkage_count")),
                     "them": f"E2: {passed(cks('TC02-'))}/{len(cks('TC02-'))} ca bệnh nhân không liên kết bị từ chối, không lưu",
                     "nguon": "comparison-report.json; E2-sai-benh-nhan-du-lieu-sai/7a-ket-qua.txt"}
    dup_e3 = ck("E3-DEM-2")
    metrics["M5"] = {"ten": "Số bản ghi trùng ở EMR", "1000": str(rep.get("duplicate_result_count")),
                     "them": f"E3 sau mọi lần gửi trùng: {dup_e3['thuc_te'] if dup_e3 else '—'} mã bị trùng",
                     "nguon": "comparison-report.json; E3-gui-trung/dem-sau.txt"}
    m6 = ck("E1-M6"); e4b = ck("E4b-1")
    metrics["M6"] = {"ten": "Số lần báo hoàn tất nhưng thực tế sai", "1000": m6["thuc_te"] if m6 else "—",
                     "them": f"E4b (EMR tắt lâu): {e4b['thuc_te'] if e4b else '—'} ca báo hoàn tất sai",
                     "nguon": "E1-1000-ket-qua/ket-qua-khong-dat-doi-chieu.txt; E4-gian-doan/E4b-ket-qua.csv"}

# ---------------- M7: xử lý ngoại lệ ----------------
groups = [("Bệnh nhân không có liên kết (TC02)", cks("TC02-")),
          ("Dữ liệu sai gửi vào middleware (TC03)", cks("TC03-MW-")),
          ("Dữ liệu sai gửi thẳng vào EMR (TC03)", cks("TC03-EMR-")),
          ("Gửi trùng (TC04)", by_scen.get("E3", [])),
          ("Thành phần tạm ngừng (TC05)", by_scen.get("E4", [])),
          ("Mất phản hồi sau khi lưu (TC06, test tự động)", cks("AUTO-TC06")),
          ("Đọc lại thấy sai (TC07, test tự động)", cks("AUTO-TC07"))]
m7_rows = [(g, passed(l), len(l)) for g, l in groups if l]
if m7_rows:
    a = sum(x[1] for x in m7_rows); b = sum(x[2] for x in m7_rows)
    metrics["M7"] = {"ten": "Tỷ lệ ca ngoại lệ xử lý đúng", "tong": ratio(a, b),
                     "theo_nhom": {g: ratio(x, y) for g, x, y in m7_rows}, "nguon": "kiem-tra.jsonl (kịch bản E2, E3, E4, AUTO)"}

# ---------------- M8: FHIR ----------------
f8 = ck("FHIR-M8")
if f8:
    metrics["M8"] = {"ten": "Bản FHIR đạt kiểm tra cấu trúc (HL7 validator, R4 4.0.1)", "1000": f"{f8['thuc_te']}/{f8['ky_vong']}",
                     "nguon": "kiem-tra-fhir/tom-tat.txt, kiem-tra-fhir/log-validator.txt"}

# ---------------- M9, M10: thời gian ----------------
STAGES = [("lis_sang_mw_ms", "LIS → middleware nhận"), ("cho_worker_ms", "Chờ bộ xử lý nền nhận việc"),
          ("anh_xa_ms", "Chuyển sang FHIR (ánh xạ)"), ("gui_emr_den_luu_ms", "Gửi sang EMR → EMR lưu"),
          ("doc_lai_xac_minh_ms", "Đọc lại & xác minh"), ("tong_ms", "TỔNG (Publish → hoàn tất)")]
def stage_stats(rows):
    rows = [r for r in rows if r.get("trang_thai") == "DELIVERED"]
    out = {}
    for col, _ in STAGES:
        v = nums(rows, col)
        out[col] = {"n": len(v), "trung_vi": pct(v, .5), "p95": pct(v, .95), "max": max(v) if v else None,
                    "min": min(v) if v else None, "tb": statistics.fmean(v) if v else None}
    return out
e1a_rows = read_csv(p("E1A-do-tre-tung-ket-qua", "thoi-gian-tung-chang.csv"))
e1_rows = read_csv(E1 / "thoi-gian-tung-chang.csv")
st_a, st_1 = stage_stats(e1a_rows), stage_stats(e1_rows)
if e1a_rows:
    t = st_a["tong_ms"]
    metrics["M9"] = {"ten": "Độ trễ đầu–cuối (Publish → hoàn tất)",
                     "gui_tung_ket_qua_40": f"trung vị {fmt_ms(t['trung_vi'])}, p95 {fmt_ms(t['p95'])}, lớn nhất {fmt_ms(t['max'])}",
                     "nguon": "E1A-do-tre-tung-ket-qua/thoi-gian-tung-chang.csv"}
    if e1_rows:
        t1 = st_1["tong_ms"]
        metrics["M9"]["don_1000_cung_luc"] = (f"trung vị {fmt_ms(t1['trung_vi'])}, p95 {fmt_ms(t1['p95'])}, lớn nhất {fmt_ms(t1['max'])}; "
            f"tốc độ ~{(mtr.get('throughput_results_per_second') or 0):.2f} kết quả/giây")
        metrics["M9"]["cong_cu_do_1000"] = (f"p50 {fmt_ms(mtr.get('latency_p50_ms'))}, p95 {fmt_ms(mtr.get('latency_p95_ms'))} "
                                          "(đo từ phía công cụ, có cộng thời gian hỏi lại mỗi 1 s)")
    a = st_a["anh_xa_ms"]
    metrics["M10"] = {"ten": "Thời gian ánh xạ sang FHIR", "gui_tung_ket_qua_40": f"trung vị {fmt_ms(a['trung_vi'])}, lớn nhất {fmt_ms(a['max'])}",
                      "nguon": "E1A-do-tre-tung-ket-qua/thoi-gian-tung-chang.csv"}
    if e1_rows:
        metrics["M10"]["don_1000_cung_luc"] = f"trung vị {fmt_ms(st_1['anh_xa_ms']['trung_vi'])}, lớn nhất {fmt_ms(st_1['anh_xa_ms']['max'])}"

# ---------------- M11, M12: phục hồi ----------------
E4 = p("E4-gian-doan")
e4a = read_csv(E4 / "E4a-ket-qua.csv"); e4c = read_csv(E4 / "E4c-ket-qua.csv"); e4d = read_csv(E4 / "E4d-ket-qua.csv")
if e4a:
    r = nums([x for x in e4a if x.get("trang_thai_middleware") == "DELIVERED"], "phuc_hoi_ms")
    metrics["M11"] = {"ten": "Thời gian phục hồi (từ lúc thành phần chạy lại → kết quả hoàn tất)",
                      "EMR_tat_ngan_E4a": f"trung vị {fmt_ms(pct(r,.5))}, lớn nhất {fmt_ms(max(r) if r else None)} (n={len(r)})",
                      "nguon": "E4-gian-doan/E4a-ket-qua.csv"}
    if e4d:
        rd = nums([x for x in e4d if x.get("trang_thai_middleware") == "DELIVERED"], "phuc_hoi_ms")
        metrics["M11"]["middleware_tat_ngan_E4d"] = f"trung vị {fmt_ms(pct(rd,.5))}, lớn nhất {fmt_ms(max(rd) if rd else None)} (n={len(rd)})"
    da = sum(1 for x in e4a if x.get("trang_thai_middleware") == "DELIVERED")
    dc = sum(1 for x in e4c if x.get("trang_thai_middleware") == "DELIVERED")
    dd = sum(1 for x in e4d if x.get("trang_thai_middleware") == "DELIVERED")
    metrics["M12"] = {"ten": "Tỷ lệ phục hồi thành công",
                      "tu_dong_EMR_tat_ngan_E4a": ratio(da, len(e4a)), "tu_dong_middleware_tat_ngan_E4d": ratio(dd, len(e4d)) if e4d else "—",
                      "EMR_tat_lau_E4b_tu_dong": "0 (đúng thiết kế: hết lượt thử lại thì dừng ở FAILED)",
                      "sau_khi_nguoi_van_hanh_dua_lai_E4c": ratio(dc, len(e4c)) if e4c else "—",
                      "nguon": "E4-gian-doan/E4a-ket-qua.csv, E4c-ket-qua.csv, E4d-ket-qua.csv"}

# ---------------- M13: độ bao phủ bằng chứng ----------------
REQ = [("REQ-FLOW-01", "Kết quả hợp lệ đi trọn LIS → middleware → EMR, đọc lại đúng", ["E1-DOICHIEU", "E1-KHOP", "E1A-HOANTAT"]),
       ("REQ-ID-01", "Đúng bệnh nhân; thiếu liên kết thì từ chối", ["E1-M4", "TC02-"]),
       ("REQ-DATA-01", "Giữ đúng mã, tên, ngữ cảnh, giá trị, đơn vị (MR03–05, MR09)", ["E1-SAI-TRUONG"]),
       ("REQ-DATA-02", "Giữ đúng cận tham chiếu, thời điểm, trạng thái (MR06–08)", ["E1-SAI-TRUONG"]),
       ("REQ-FHIR-01", "Observation đúng cấu trúc FHIR R4", ["FHIR-"]),
       ("REQ-ERR-01", "Dữ liệu sai bị từ chối có lý do, không lưu, không báo hoàn tất", ["TC03-", "E2-TONG-"]),
       ("REQ-DUP-01", "Gửi trùng không tạo bản ghi mới; khác nội dung thì báo xung đột", ["E3-"]),
       ("REQ-RETRY-01", "Lỗi tạm thời được thử lại có giới hạn, không báo hoàn tất sai", ["E4a-", "E4b-", "E4c-"]),
       ("REQ-OUTBOX-01", "LIS giữ yêu cầu đến khi middleware xác nhận đã nhận", ["E4d-"]),
       ("REQ-WORKER-01", "Việc dở dang được nhận lại an toàn (test tự động)", ["AUTO-TONG"]),
       ("REQ-MEASURE-01", "Có mốc thời gian để đo từng chặng", ["E1A-HOANTAT"]),
       ("REQ-EVIDENCE-01", "Dữ liệu nguồn, FHIR, đích, nhật ký được liên kết để kiểm tra lại", ["E1-DOICHIEU", "E1-FHIR-XUAT"])]
req_rows = []
for code, desc, keys in REQ:
    rel = [c for c in checks if any(c["ma"] == k or (k.endswith("-") and c["ma"].startswith(k)) for k in keys)]
    st = "CHƯA CÓ BẰNG CHỨNG" if not rel else ("ĐẠT" if all(c["ket_qua"] == "DAT" for c in rel) else "CÓ CA KHÔNG ĐẠT")
    req_rows.append((code, desc, st, f"{passed(rel)}/{len(rel)}"))
metrics["M13"] = {"ten": "Mức độ bao phủ bằng chứng (yêu cầu cốt lõi có bằng chứng đạt / 12)",
                  "gia_tri": ratio(sum(1 for r in req_rows if r[2] == "ĐẠT"), len(REQ)), "nguon": "kiem-tra.jsonl"}

(OUT / "chi-so.json").write_text(json.dumps({"run_tag": tag, "chi_so": metrics,
    "thoi_gian_E1A": st_a, "thoi_gian_E1_1000": st_1, "yeu_cau": req_rows}, ensure_ascii=False, indent=2))

# ---------------- Biểu đồ ----------------
charts = []
try:
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    BLUE, INK, INK2, GRID, SURF = "#2a78d6", "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
    plt.rcParams.update({"font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2,
                         "ytick.color": INK2, "axes.facecolor": SURF, "figure.facecolor": SURF, "axes.spines.top": False,
                         "axes.spines.right": False, "axes.grid": True, "grid.color": GRID, "grid.linewidth": .6})
    BD = OUT / "bieu-do"; BD.mkdir(exist_ok=True)
    if e1a_rows:
        labels = [lbl for c, lbl in STAGES if c != "tong_ms"]; vals = [st_a[c]["trung_vi"] or 0 for c, _ in STAGES if c != "tong_ms"]
        fig, ax = plt.subplots(figsize=(7.5, 3.2))
        ax.barh(labels[::-1], vals[::-1], color=BLUE, height=.5); ax.grid(axis="y", visible=False)
        for y, v in enumerate(vals[::-1]): ax.text(v, y, "  " + fmt_ms(v), va="center", color=INK, fontsize=9)
        ax.set_xlabel("Thời gian trung vị (ms)"); ax.set_xlim(0, max(vals) * 1.3 if max(vals) else 1)
        ax.set_title("Thời gian từng chặng khi gửi từng kết quả một (40 kết quả lõi)", color=INK, loc="left", fontsize=11)
        fig.tight_layout(); fig.savefig(BD / "1-thoi-gian-tung-chang.png", dpi=200); plt.close(fig); charts.append("1-thoi-gian-tung-chang.png")
        tot = [v / 1000 for v in nums([r for r in e1a_rows if r.get("trang_thai") == "DELIVERED"], "tong_ms")]
        fig, ax = plt.subplots(figsize=(7.5, 2.8))
        ax.plot(range(1, len(tot) + 1), tot, "o", color=BLUE, markersize=5); ax.set_ylim(0, max(tot) * 1.2 if tot else 1)
        ax.set_xlabel("Thứ tự kết quả"); ax.set_ylabel("Giây")
        ax.set_title("Độ trễ đầu–cuối của từng kết quả (gửi lần lượt)", color=INK, loc="left", fontsize=11)
        fig.tight_layout(); fig.savefig(BD / "2-do-tre-tung-ket-qua.png", dpi=200); plt.close(fig); charts.append("2-do-tre-tung-ket-qua.png")
    if e1_rows:
        tot = [v / 1000 for v in nums([r for r in e1_rows if r.get("trang_thai") == "DELIVERED"], "tong_ms")]
        fig, ax = plt.subplots(figsize=(7.5, 2.8))
        ax.plot(range(1, len(tot) + 1), tot, color=BLUE, linewidth=2); ax.set_ylim(0, max(tot) * 1.1 if tot else 1)
        ax.set_xlabel("Thứ tự kết quả được gửi (1.000 kết quả dồn cùng lúc)"); ax.set_ylabel("Giây")
        ax.set_title("Khi dồn 1.000 kết quả: thời gian chờ tăng dần theo hàng đợi", color=INK, loc="left", fontsize=11)
        fig.tight_layout(); fig.savefig(BD / "3-do-tre-khi-don-1000.png", dpi=200); plt.close(fig); charts.append("3-do-tre-khi-don-1000.png")
    if e4a:
        rows = [x for x in e4a if x.get("phuc_hoi_ms")]
        fig, ax = plt.subplots(figsize=(7.5, 2.8))
        ax.bar([x["ma_ket_qua"].replace("MIMIC-LAB-", "") for x in rows], [float(x["phuc_hoi_ms"]) / 1000 for x in rows], color=BLUE, width=.5)
        ax.grid(axis="x", visible=False); ax.set_ylabel("Giây"); ax.set_xlabel("Mã kết quả (MIMIC-LAB-…)")
        ax.tick_params(axis="x", labelsize=8, rotation=30)
        ax.set_title("E4a – thời gian từ lúc EMR chạy lại đến khi kết quả hoàn tất", color=INK, loc="left", fontsize=11)
        fig.tight_layout(); fig.savefig(BD / "4-phuc-hoi-E4a.png", dpi=200); plt.close(fig); charts.append("4-phuc-hoi-E4a.png")
except ImportError:
    notes["bieu_do"] = "Không có matplotlib nên không vẽ biểu đồ (sudo pacman -S python-matplotlib rồi chạy lại bước 08)."

# ---------------- TONG_HOP_SO_LIEU.md ----------------
LABELS = {"1000": "1.000 kết quả", "40_loi": "40 kết quả lõi", "them": "Thêm", "tong": "Tổng",
          "gui_tung_ket_qua_40": "Gửi từng kết quả một (40 lõi)", "don_1000_cung_luc": "Dồn 1.000 kết quả cùng lúc",
          "cong_cu_do_1000": "Theo công cụ đo (1.000)", "EMR_tat_ngan_E4a": "EMR tắt ngắn (E4a)",
          "middleware_tat_ngan_E4d": "Middleware tắt ngắn (E4d)", "tu_dong_EMR_tat_ngan_E4a": "Tự phục hồi, EMR tắt ngắn (E4a)",
          "tu_dong_middleware_tat_ngan_E4d": "Tự phục hồi, middleware tắt ngắn (E4d)",
          "EMR_tat_lau_E4b_tu_dong": "EMR tắt lâu (E4b), tự phục hồi",
          "sau_khi_nguoi_van_hanh_dua_lai_E4c": "Sau khi người vận hành đưa lại (E4c)", "gia_tri": "Giá trị"}
L = []
w = L.append
w(f"# Tổng hợp số liệu thực nghiệm – đợt {tag}\n")
w("> File này do `08-tong-hop.py` tự sinh từ dữ liệu thô. **Không sửa tay** – muốn sửa thì sửa dữ liệu/script rồi chạy lại.\n")
env = p("00-moi-truong.txt")
if env.exists(): w("## 0. Môi trường chạy\n\n```\n" + env.read_text().strip() + "\n```\n")
w("## 1. Các chỉ số đánh giá M1–M13\n")
w("| Chỉ số | Ý nghĩa | Kết quả | Lấy từ file |\n|---|---|---|---|")
for k in [f"M{i}" for i in range(1, 14)]:
    m = metrics.get(k)
    if not m: w(f"| {k} | — | chưa có dữ liệu | — |"); continue
    vals = [f"{LABELS.get(kk, kk)}: {vv}" for kk, vv in m.items() if kk not in ("ten", "nguon", "theo_nhom")]
    if "theo_nhom" in m: vals += [f"{g}: {v}" for g, v in m["theo_nhom"].items()]
    w(f"| {k} | {m['ten']} | {'<br>'.join(vals)} | {m.get('nguon','')} |")
w("\n## 2. Yêu cầu cốt lõi và bằng chứng (dùng cho M13)\n")
w("| Yêu cầu | Nội dung | Kết luận | Số phép kiểm tra đạt |\n|---|---|---|---|")
for r in req_rows: w(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} |")
w("\n## 3. Thời gian từng chặng\n")
for title, st in [("Gửi từng kết quả một (40 kết quả lõi, bước 05)", st_a), ("Dồn 1.000 kết quả cùng lúc (bước 02)", st_1)]:
    if not st or not st["tong_ms"]["n"]: continue
    w(f"**{title}** – số kết quả: {st['tong_ms']['n']}\n")
    w("| Chặng | Nhỏ nhất | Trung vị | p95 | Lớn nhất |\n|---|---|---|---|---|")
    for c, lbl in STAGES:
        s = st[c]; w(f"| {lbl} | {fmt_ms(s['min'])} | {fmt_ms(s['trung_vi'])} | {fmt_ms(s['p95'])} | {fmt_ms(s['max'])} |")
    w("")
w("Ghi chú: p95 = 95% kết quả nhanh hơn mức này. Thời gian lấy từ mốc hệ thống tự ghi; bộ xử lý nền hỏi hàng đợi mỗi 1 giây "
  "nên 'chờ bộ xử lý nền nhận việc' dao động 0–1 s.\n")
if field_rows:
    w("## 4. Đối chiếu theo từng trường (1.000 kết quả, bước 02)\n")
    w("| Quy tắc : trường | Đúng | Sai | Chưa xác minh |\n|---|---|---|---|")
    cnt = defaultdict(Counter)
    for r in field_rows: cnt[f"{r['rule_id']}:{r['field_path']}"][r["outcome"]] += 1
    for k in sorted(cnt): w(f"| {k} | {cnt[k]['PASS']} | {cnt[k]['FAIL']} | {cnt[k]['NOT_VERIFIED']} |")
    w("")
w("## 5. Kết quả từng phép kiểm tra (kỳ vọng ↔ thực tế)\n")
NAMES = {"PRE": "Kiểm tra trước khi chạy", "AUTO": "Bộ test tự động (TC06, TC07)", "E1": "E1 – 1.000 kết quả hợp lệ (TC01)",
         "E1A": "E1A – gửi từng kết quả một (TC01, thời gian)", "E2": "E2 – sai bệnh nhân, dữ liệu sai (TC02, TC03)",
         "E3": "E3 – gửi trùng (TC04)", "E4": "E4 – thành phần tạm ngừng (TC05)", "FHIR": "Kiểm tra cấu trúc FHIR (M8)"}
for s in ["PRE", "AUTO", "E1", "E1A", "E2", "E3", "E4", "FHIR"]:
    lst = by_scen.get(s)
    if not lst: continue
    w(f"### {NAMES[s]} – đạt {passed(lst)}/{len(lst)}\n")
    w("| Mã | Kiểm tra gì | Kỳ vọng | Thực tế | Kết quả |\n|---|---|---|---|---|")
    for c in lst:
        w(f"| {c['ma']} | {c['mo_ta']} | {c['ky_vong']} | {c['thuc_te']} | {'✅ Đạt' if c['ket_qua']=='DAT' else '❌ Không đạt'} |")
    w("")
bad = [c for c in checks if c["ket_qua"] != "DAT"]
w("## 6. Các ca KHÔNG như kỳ vọng\n")
w("Không có." if not bad else "| Kịch bản | Mã | Kiểm tra gì | Kỳ vọng | Thực tế |\n|---|---|---|---|---|")
for c in bad: w(f"| {c['kich_ban']} | {c['ma']} | {c['mo_ta']} | {c['ky_vong']} | {c['thuc_te']} |")
w("")
if charts:
    w("## 7. Biểu đồ\n"); [w(f"![{c}](bieu-do/{c})\n") for c in charts]
if notes: w("## Ghi chú\n"); [w(f"- {v}") for v in notes.values()]
w("\n## 8. Trạng thái các bước\n")
st_dir = p("trang-thai")
for f in sorted(st_dir.glob("*")):
    w(f"- {f.name}: {f.read_text().strip()[:120]}")
(OUT / "TONG_HOP_SO_LIEU.md").write_text("\n".join(L) + "\n")
print(json.dumps({"ok": True, "so_phep_kiem_tra": len(checks), "khong_dat": len(bad), "bieu_do": charts,
                  "file": str(OUT / "TONG_HOP_SO_LIEU.md")}, ensure_ascii=False))
