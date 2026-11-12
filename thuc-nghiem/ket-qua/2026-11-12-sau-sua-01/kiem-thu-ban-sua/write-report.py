from pathlib import Path
from collections import Counter
import csv,gzip,hashlib,json,subprocess,sys
out=Path(sys.argv[1]).resolve()
root=out.parents[2]
old=root/'thuc-nghiem/ket-qua/2026-11-11'
def js(p):
    p=Path(p)
    return json.loads(p.read_text()) if p.exists() else json.load(gzip.open(str(p)+'.gz','rt'))
def checks(p):return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]
a,b=checks(old/'kiem-tra.jsonl'),checks(out/'kiem-tra.jsonl')
ac,bc={x['ma']:x for x in a},{x['ma']:x for x in b}
counts=Counter(x['ket_qua'] for x in b)
assert len(b)==70 and counts['DAT']==70
metrics=js(out/'chi-so.json'); om=js(old/'chi-so.json')
manifest=js(out/'run-manifest.json')
report=js(out/'E1-1000-ket-qua/doi-chieu/comparison-report.json')
fields=[v for k,v in report['per_field'].items() if k.startswith('MR')]
assert sum(v['PASS'] for v in fields)==24000 and sum(v['FAIL']+v['NOT_VERIFIED'] for v in fields)==0
validator=js(out/'kiem-tra-fhir/ket-qua-validator.json')
issues=[i for entry in validator.get('entry',[]) for i in entry['resource'].get('issue',[])]
errors=sum(i.get('severity') in ('error','fatal') for i in issues)
assert len(validator.get('entry',[]))==1000 and errors==0
warnings=Counter((i.get('details') or {}).get('text','') for i in issues if i.get('severity')=='warning')
auto=(out/'01-test-tu-dong/tom-tat.txt').read_text().strip()
unit=js(out/'kiem-thu-ban-sua/summary.json')
lines=['# Báo cáo thực nghiệm sau sửa lỗi LIS → FHIR → EMR','',f'Đợt `{out.name}`. Mã nền `{manifest["base_commit"][:7]}`; bản sửa chưa commit được định danh bằng fingerprint trong `run-manifest.json`.','',
'## 1. Kết quả chính','',f'- Các phép kiểm tra: **{counts["DAT"]}/{len(b)} đạt**, {counts["KHONG_DAT"]} không đạt.',
f'- E1: **{report["matched_result_count"]}/{report["total_expected_results"]}** kết quả khớp bộ đáp án độc lập; đối chiếu **{report["outcome"]}**.',
'- Đối chiếu theo trường: **24000/24000** phép so sánh MR01–MR09 đúng; 0 sai, 0 chưa xác minh.',
f'- FHIR M8: **{bc["FHIR-M8"]["thuc_te"]}/{bc["FHIR-M8"]["ky_vong"]}** file không có error/fatal; tổng error/fatal: **{errors}**.',
f'- E2: dữ liệu sai bị báo DELIVERED = **{bc["E2-TONG-1"]["thuc_te"]}**; bản ghi sai lọt vào EMR = **{bc["E2-TONG-2"]["thuc_te"]}**.',
'- Cấu hình polling, retry, timeout và số tiến trình giữ nguyên. Đợt này không tối ưu hiệu năng.','',
'## 2. So sánh trực tiếp trước–sau','',
'| Phép kiểm tra | Trước sửa (11/11) | Sau sửa | Kết luận sau sửa |','|---|---|---|---|']
for key in ['TC03-MW-1','TC03-MW-2','TC03-EMR-7','E2-TONG-1','E2-TONG-2','FHIR-M8','TC03-EMR-9','TC03-EMR-10']:
    labels={'TC03-MW-1':'mã lạ vào middleware','TC03-MW-2':'đơn vị sai vào middleware','TC03-EMR-7':'mã lạ vào EMR','E2-TONG-1':'số ca báo hoàn tất sai','E2-TONG-2':'số bản ghi sai ở EMR','FHIR-M8':'số Observation đạt / 1000','TC03-EMR-9':'đơn vị sai nhưng nhất quán','TC03-EMR-10':'đơn vị sai, không có cận'}
    prior=ac.get(key,{}).get('thuc_te','Chưa có ca này')
    current=bc.get(key,{})
    lines.append(f'| `{key}` — {labels[key]} | {prior.replace("|","/")} | {current.get("thuc_te","Chưa đo").replace("|","/")} | {current.get("ket_qua","CHUA_DO")} |')
lines += ['',f'Đợt cũ có {len(a)} phép kiểm tra; đợt mới có {len(b)}. Hai ca E2 bổ sung kiểm tra đơn vị sai nhưng nhất quán và đơn vị sai không có cận; một phép thử validator trên một file được thêm trước bước 1000 file. Không dùng tỷ lệ tổng để thay thế việc so sánh từng ca tương ứng.', '',
'## 3. Những thay đổi đã kiểm chứng','',
'- Middleware kiểm tra mã/đơn vị sau kiểm tra cấu trúc và hash. EMR kiểm tra trước khi liên kết bệnh nhân và ghi dữ liệu. Không cấp quyền đọc chéo schema.',
'- Policy có đúng năm cặp mã–đơn vị, được kiểm tra khớp seed; không đổi mã, chuyển đơn vị hoặc sửa snapshot.',
'- Mapper dùng `lis-observation-v2`. Namespace URN thống nhất giữa mapper, EMR, patient links, monitor và frontend; namespace không phụ thuộc địa chỉ giao diện localhost.',
'- Bộ đáp án v3 thay đúng năm cột namespace từ v2; 1000 đáp án lâm sàng được kiểm tra lại với raw MIMIC và seed. Bộ v2 và minh chứng cũ giữ nguyên.',
'- Ghi kiểm tra sử dụng cùng khóa `flock` cho lọc/thay và append. Test đồng thời xác nhận không mất dòng và chạy lại không nhân đôi.',
'- Parser nhận TAP/spec; tiến trình test lỗi hoặc không chạy test không được PASS. Bước đóng gói dùng `PACK_GIT=0`.','',
'## 4. Các kịch bản hồi quy và số đo','',
'| Kịch bản | Số phép đạt / tổng |','|---|---|']
for scenario in ['PRE','E1','E2','E3','E1A','E4','AUTO','FHIR']:
    rows=[x for x in b if x['kich_ban']==scenario]
    lines.append(f'| {scenario} | {sum(x["ket_qua"]=="DAT" for x in rows)}/{len(rows)} |')
lines += ['', 'E4b hết ngân sách retry rồi FAILED là hành vi đúng thiết kế, không phải lỗi mới. E4c kiểm tra đường đưa lại thủ công; các điều kiện chống trùng và không báo hoàn tất sai được giữ nguyên. TC06/TC07 tiếp tục có bằng chứng từ test tự động.', '',
'| Chỉ số thời gian | Trước sửa | Sau sửa |','|---|---|---|']
for key,label in [('thoi_gian_E1_1000','E1 dồn 1000'),('thoi_gian_E1A','E1A từng kết quả')]:
    for col,colname in [('tong_ms','đầu–cuối'),('anh_xa_ms','ánh xạ')]:
        prev=om[key][col];cur=metrics[key][col]
        lines.append(f'| {label}, {colname} | trung vị {prev["trung_vi"]:.3f} ms; p95 {prev["p95"]:.3f} ms | trung vị {cur["trung_vi"]:.3f} ms; p95 {cur["p95"]:.3f} ms |')
lines += ['', 'Thời gian là số mô tả của từng đợt trên một máy. Không đặt ngưỡng hiệu năng mới và không kết luận tối ưu do đợt sửa này.', '',
'![Độ trễ khi dồn 1000 kết quả](bieu-do/3-do-tre-khi-don-1000.png)', '', '![Thời gian từng chặng khi gửi lần lượt](bieu-do/1-thoi-gian-tung-chang.png)', '', '## 5. Kiểm thử và kiểm tra trình duyệt','', '```text',auto,'```','',
f'- Test SPP82: {unit["spp82"]["pass"]}/{unit["spp82"]["tests"]}; ops: {unit["ops"]["pass"]}/{unit["ops"]["tests"]}.',
f'- Test frontend ba workspace: {unit["frontend"]["pass"]}/{unit["frontend"]["tests"]}. Backend TypeScript, frontend check/build: PASS.',
'- Test hồi quy trên mã nền và mã đã sửa được lưu riêng, chứng minh các ca mới phát hiện hành vi sai trước khi sửa.',
'- Kiểm tra Chrome với API thực: tìm theo mã bệnh nhân, đọc kết quả EMR, 9 trường hiển thị khớp, receipt STORED trên cả ba entrypoint. Chỉ gửi GET; ảnh và danh sách HTTP nằm trong `kiem-tra-trinh-duyet/`.', '',
'## 6. Môi trường, khả năng tái kiểm tra và giới hạn','',
f'- Reference: `{manifest["reference"]["version"]}`, rules `{manifest["reference"]["rules_version"]}`, SHA-256 manifest `{manifest["reference"]["manifest_sha256"]}`.',
f'- Source tree SHA-256: `{manifest["source_tree_sha256"]}`. Không tạo commit hoặc push trong phiên này.',
'- Cấu hình mặc định: HTTP timeout 3000 ms, lease 15000 ms, polling 1000 ms; retry sau 2000/4000/8000 ms, 4 lần thử; 1 dispatcher và 1 worker. E4c dùng tạm ngân sách 7 lần để đưa lại, rồi khôi phục mặc định, giống protocol đợt cũ.',
'- HL7 validator 7.0.5, FHIR R4 4.0.1; terminology mặc định như đợt cũ. SHA-256 JAR nằm trong `kiem-tra-fhir/validator-jar.sha256`.',
f'- Validator trả {len(validator.get("entry",[]))} kết quả file; có {sum(warnings.values())} lượt warning. Warning không được xóa hay đổi mức; tiêu chí M8 vẫn là không có error/fatal.',
'- Một máy, một đợt chạy; dữ liệu MIMIC đã khử định danh, ngày 21xx, FINAL và UTC là giả định mô phỏng. Mã/đơn vị vẫn là hợp đồng cục bộ; chưa tuyên bố LOINC/UCUM hoặc đánh giá lâm sàng đầy đủ.',
'- Đợt mới chạy trên lisexp sạch. Không di trú DB demo cũ và không ghi đè FHIR/hash đã lưu. Trạng thái demo trước khi chạy được ghi trong nhật ký.', '',
'## 7. Minh chứng','',
'| Đường dẫn tương đối | Nội dung |','|---|---|',
'| `kiem-tra.jsonl` | Kỳ vọng, thực tế, kết luận từng ca |',
'| `run-manifest.json` | Fingerprint mã nguồn, cấu hình và oracle |',
'| `TONG_HOP_SO_LIEU.md`, `chi-so.json` | Chỉ số và mẫu số tự sinh |',
'| `E1-1000-ket-qua/doi-chieu/` | Kết quả đối chiếu độc lập theo kết quả và trường |',
'| `E2-sai-benh-nhan-du-lieu-sai/` | Gói tin, HTTP, trạng thái và số hàng sai ở EMR |',
'| `E3-gui-trung/`, `E4-gian-doan/` | Chống trùng, gián đoạn và requeue |',
'| `kiem-tra-fhir/` | Kết quả validator, warning, phiên bản và checksum JAR |',
'| `kiem-thu-ban-sua/` | Log test, hồi quy mã cũ và xác nhận dữ liệu được bảo vệ |',
'| `kiem-tra-trinh-duyet/` | Báo cáo Chrome, ảnh và HTTP GET thực |',
'| `MINH_CHUNG_SHA256.txt` | Kiểm tra tính nguyên vẹn sau đóng gói |','',
'Kiểm tra lại: chạy `sha256sum -c MINH_CHUNG_SHA256.txt` trong thư mục đợt này. File thô lớn được nén gzip; nội dung giải nén giữ nguyên.','']
(out/'BAO_CAO_KET_QUA_THUC_NGHIEM.md').write_text('\n'.join(lines))
print(json.dumps({'checks':dict(counts),'total':len(b),'e1':report['matched_result_count'],'validator_errors':errors},ensure_ascii=False))
