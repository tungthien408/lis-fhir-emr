# Bổ sung cho đợt sau sửa lỗi (12/11/2026)

- Sau khi hoàn tất sửa/test sản phẩm, chạy lại protocol bên dưới với `RUN_TAG` mới.
- Dùng `EXPERIMENT_REFERENCE_VERSION=v3` (mặc định); v2 chỉ dùng để đọc/đối chiếu đợt cũ.
- Chạy `bash thuc-nghiem/tests/checks-store.test.sh` và `bash thuc-nghiem/tests/test-log.test.sh` trước đợt mới.
- Bước 01 và 07 được chạy song song sau khi test khóa file đạt; không chạy chúng cùng các bước đo thời gian.
- Validator được khóa ở 7.0.5 / FHIR 4.0.1; không tải bản latest hoặc bỏ qua lỗi URI.
- E2 có thêm hai ca: đơn vị sai nhưng nhất quán và đơn vị sai không có cận; báo mẫu số thực tế.
- Ghi `run-manifest.json`, giữ nguyên bằng chứng đợt cũ. Đóng gói bằng `PACK_GIT=0` khi không được yêu cầu commit.
- Luật không sửa sản phẩm bên dưới áp dụng trong giai đoạn đo, sau khi sửa và test đã hoàn tất.

---

# Hướng dẫn chạy thực nghiệm – dành cho Claude Code

> Người giao việc: Thiện (backend) – đang treo máy, **không có mặt để trả lời câu hỏi**.
> Người dùng kết quả: bạn cùng nhóm, người viết **Chương 3** của báo cáo Đồ án chuyên ngành.
> Hạn nộp báo cáo: 15/11/2026.

Đọc hết file này một lần rồi làm theo thứ tự. Không cần đọc thêm tài liệu nào khác trong repo trừ khi một bước bị lỗi.

---

## 1. Mục tiêu

Chạy các kịch bản thực nghiệm trên prototype LIS → middleware → EMR (FHIR R4), thu **minh chứng rõ ràng, kiểm tra lại được**,
rồi viết **một báo cáo dễ đọc** trình bày lại kết quả để bạn cùng nhóm đưa vào Chương 3.

Kết quả cuối cùng nằm trong `thuc-nghiem/ket-qua/<ngày>/`:

| File | Ai tạo | Nội dung |
|---|---|---|
| `TIEN_DO.md` | **bạn** (Claude Code) | Nhật ký tiến độ ngắn, cập nhật sau mỗi bước |
| `TONG_HOP_SO_LIEU.md`, `chi-so.json`, `bieu-do/*.png` | script bước 08 | Bảng số liệu tự sinh – không sửa tay |
| `BAO_CAO_KET_QUA_THUC_NGHIEM.md` | **bạn** | Báo cáo trình bày kết quả (mục 6) |
| `MINH_CHUNG_SHA256.txt` | script bước 09 | Dấu vân tay mọi file minh chứng |
| các thư mục `E1-…`, `E2-…`, … | các script | Dữ liệu thô, minh chứng từng kịch bản |

## 2. Luật bắt buộc

1. **Không sửa code sản phẩm**: không đụng `backend/src`, `backend/scripts` (ngoài việc chạy), `database/`, `frontend/`, `compose.yaml`.
   Thực nghiệm đo code **như hiện tại**. Một phép kiểm tra "KHÔNG ĐẠT" là **kết quả**, không phải lỗi cần sửa.
2. Chỉ được sửa file trong `thuc-nghiem/` (script, báo cáo) – và chỉ để sửa **lỗi vận hành** (lệnh sai, chờ chưa đủ lâu, đường dẫn…), không để làm đẹp kết quả.
   Mọi lần sửa script phải ghi vào `TIEN_DO.md`: sửa gì, vì sao.
3. **Không** `git push`, **không** `sudo`, **không** xóa volume/container nào không thuộc project `lisexp`
   (không bao giờ chạy `docker compose down -v` mà không có `-p lisexp`). Không đọc file `.env`.
4. **Không bịa số.** Mọi con số trong báo cáo phải lấy từ `TONG_HOP_SO_LIEU.md`, `chi-so.json` hoặc file minh chứng.
   Cần số mới thì tính bằng lệnh và ghi lại lệnh đó trong phụ lục báo cáo.
5. Không hỏi người dùng (họ vắng mặt). Gặp tình huống mơ hồ: chọn cách an toàn hơn, ghi lại lựa chọn vào `TIEN_DO.md`, đi tiếp.

## 3. Tiết kiệm token (quan trọng)

- **Không dùng subagent.** Làm hết trong phiên này.
- **Không mở các file lớn** sau: `field-comparisons.jsonl`, `per-result*.jsonl`, `publish.jsonl`, `fhir-1000/`, `*.sql.gz`,
  `db-truoc.json`, `db-sau.json`, `log-day-du.txt`, `log-validator.txt`, `ket-qua-validator.json`, `stdout.log`.
  Cần thông tin trong đó thì dùng `tail -n 20`, `grep -c`, `jq` có lọc.
- Chỉ đọc file nhỏ: `nhat-ky-chay.log` (dùng `tail`), `tom-tat.txt`, `summary.md`, các `*-ket-qua.csv/txt`, `TONG_HOP_SO_LIEU.md`.
- Bước dài (01, 02, 07): chạy bằng **chế độ chạy nền** của công cụ Bash, rồi chờ bằng `sleep 240` và kiểm tra bằng
  `tail -n 3 thuc-nghiem/ket-qua/*/nhat-ky-chay.log; ls thuc-nghiem/ket-qua/*/trang-thai/`. Đừng kiểm tra dồn dập.
- Khi script in ra nhiều dòng, chỉ xem phần cuối (`| tail -n 30`).

## 4. Các bước

Mọi lệnh chạy từ **thư mục gốc repo**. Mỗi script tự ghi nhật ký vào `ket-qua/<ngày>/nhat-ky-chay.log`, tự ghi trạng thái vào
`ket-qua/<ngày>/trang-thai/<bước>.xong` (hoặc `.loi` khi lỗi), và tự ghi mỗi phép kiểm tra "kỳ vọng ↔ thực tế" vào `kiem-tra.jsonl`.

**Chạy tiếp khi bị ngắt:** nếu `ket-qua/<ngày>/TIEN_DO.md` đã có, đọc nó và `ls trang-thai/`, bắt đầu từ bước đầu tiên chưa có `.xong`.
Lưu ý: bước 03, 04 phải chạy trên môi trường của bước 02; bước 06 phải chạy trên môi trường của bước 05.
Nếu máy đã khởi động lại giữa chừng thì chạy lại từ bước 02 (hoặc 05) cho nhóm đó.

| # | Lệnh | Làm gì | Thời gian | Chạy nền? |
|---|---|---|---|---|
| 00 | `bash thuc-nghiem/00-kiem-tra-truoc.sh` | Kiểm tra công cụ, `.env`, tạm dừng stack demo (không xóa dữ liệu), ghi cấu hình máy | 1–3 phút | không |
| 01 | `bash thuc-nghiem/01-test-tu-dong.sh` | Chạy toàn bộ test tự động của repo (minh chứng TC06, TC07) | 10–20 phút | **có** |
| 02 | `bash thuc-nghiem/02-E1-1000-ket-qua.sh` | E1: chạy thử 20, rồi 1.000 kết quả + đối chiếu độc lập + thời gian từng chặng + xuất FHIR | 25–40 phút | **có** |
| 03 | `bash thuc-nghiem/03-E3-gui-trung.sh` | E3: gửi trùng ở cả 3 chặng | 1 phút | không |
| 04 | `bash thuc-nghiem/04-E2-sai-benh-nhan-du-lieu-sai.sh` | E2: bệnh nhân không liên kết + 14 ca dữ liệu sai | 2–3 phút | không |
| 05 | `bash thuc-nghiem/05-E1A-do-tre-tung-ket-qua.sh` | E1A: môi trường mới, gửi lần lượt 40 kết quả lõi để đo độ trễ thật | 3–5 phút | không |
| 06 | `bash thuc-nghiem/06-E4-gian-doan.sh` | E4: tắt EMR ngắn/lâu, đưa lại bằng tay, tắt middleware | 6–8 phút | không (đặt timeout 10 phút) |
| 07 | `bash thuc-nghiem/07-kiem-tra-fhir.sh` | Kiểm tra cấu trúc 1.000 bản FHIR bằng HL7 validator (M8) | 5–30 phút | **có** |
| 08 | `python3 thuc-nghiem/08-tong-hop.py` | Sinh `TONG_HOP_SO_LIEU.md`, `chi-so.json`, biểu đồ | vài giây | không |
| — | (bạn viết) | `BAO_CAO_KET_QUA_THUC_NGHIEM.md` theo mục 6 | — | — |
| 09 | `bash thuc-nghiem/09-dong-goi.sh` | Mã SHA-256 minh chứng, tắt môi trường thực nghiệm, bật lại stack demo, commit vào nhánh riêng (không push) | 1 phút | không |

**Thứ tự chạy:** 00 → 02 → 03 → 04 → 05 → 06 → (01 và 07 chạy nền **cùng lúc**) → 08 → viết báo cáo → 08 (chạy lại nếu có sửa) → 09.
Lý do: các bước đo thời gian (02, 05, 06) phải chạy một mình để máy không bị việc khác làm chậm;
01 và 07 không đo thời gian nên để cuối và chạy song song cho nhanh.

Sau mỗi bước: thêm 1–3 dòng vào `TIEN_DO.md` (giờ, bước, xong/lỗi, số phép kiểm tra đạt/không đạt – lấy bằng
`grep -c '"ket_qua":"KHONG_DAT"' kiem-tra.jsonl`).

## 5. Khi có sự cố

| Tình huống | Làm gì |
|---|---|
| Bước 00 báo thiếu công cụ cần `sudo` (jq, java, matplotlib…) | Không cài được. Bỏ qua phần phụ thuộc (java → bỏ bước 07; matplotlib → không có biểu đồ), ghi vào `TIEN_DO.md`, đi tiếp. Thiếu `jq`/`docker`/`node` → dừng hẳn, ghi rõ lý do và cách khắc phục vào `TIEN_DO.md`. |
| Bước 00 báo cổng bị chiếm | `docker ps` xem container nào. Bước 00 đã tự tạm dừng stack demo; nếu vẫn bị chiếm bởi thứ khác thì ghi vào `TIEN_DO.md` và dừng (không tự tắt tiến trình lạ). |
| Một script dừng giữa chừng (`trang-thai/*.loi`) | `tail -n 30 .../nhat-ky-chay.log` và `tail -n 30` file `stderr.log`/log của bước đó. Lỗi vận hành → sửa script trong `thuc-nghiem/`, chạy lại bước (tối đa 2 lần). Vẫn lỗi → ghi lại, chuyển sang bước không phụ thuộc. |
| Bước 02 chạy thử 20 không đạt 20/20 | Đây là lỗi chặn. Xem `E1-1000-ket-qua/chay-thu-20/stderr.log`, `docker compose -p lisexp logs --tail 50 middleware-worker`. Thường do dịch vụ chưa sẵn sàng → chạy lại bước 02. |
| Bộ đối chiếu (bước 02) ra `NOT_VERIFIED` | Thường do thiếu ảnh chụp DB "trước" hoặc DB không có dấu "disposable". Xem `capture-truoc.log`, `capture-sau.log`. Sửa rồi chạy lại cả bước 02. |
| Bước 07 không tải được gói FHIR / máy chủ thuật ngữ | Chạy lại với `VALIDATOR_TX=n/a bash thuc-nghiem/07-kiem-tra-fhir.sh`. Vẫn lỗi → ghi M8 = "chưa đo được" kèm lý do. |
| Bước 07: số file công cụ báo kết quả ≠ 1000 | Định dạng log của validator có thể khác. Xem `tail -n 40 kiem-tra-fhir/log-validator.txt`, sửa cách đếm trong script 07 (chỉ phần `grep`), chạy lại. |
| Phép kiểm tra "KHÔNG ĐẠT" | **Không sửa gì.** Ghi nhận. Trong báo cáo, phân tích nguyên nhân dựa trên file minh chứng (mục 6.6). |
| Máy chạy chậm, `wait_settled` hết giờ | Tăng thời gian chờ trong script (ghi vào `TIEN_DO.md`), chạy lại bước đó. |

## 6. Viết báo cáo `BAO_CAO_KET_QUA_THUC_NGHIEM.md`

Viết **sau** khi chạy bước 08. Đọc `TONG_HOP_SO_LIEU.md` và `chi-so.json` (đủ số liệu), xem nhanh các file `*-ket-qua.txt/csv`
của từng kịch bản để hiểu chi tiết. Đặt file trong `thuc-nghiem/ket-qua/<ngày>/`.

### 6.1 Người đọc và giọng văn

Người đọc là bạn cùng nhóm, sẽ chép/viết lại thành Chương 3 bằng tiếng Việt học thuật. Vì vậy:

- Câu ngắn, rõ, tự nhiên. Mỗi đoạn một ý.
- Thuật ngữ kỹ thuật chỉ dùng khi cần, và **giải thích một lần ở lần đầu xuất hiện**, ví dụ:
  "Publish (thao tác phát hành kết quả ở LIS)", "middleware (thành phần trung gian)",
  "DELIVERED (trạng thái: đã lưu ở EMR và đã đọc lại đối chiếu đúng)", "p95 (95% kết quả nhanh hơn mức này)".
- Ưu tiên từ Việt thông dụng: "gửi lại" thay "retry", "trùng" thay "duplicate", "đối chiếu" thay "verify".
  Giữ nguyên tên riêng của hệ thống/chuẩn: LIS, EMR, FHIR R4, Observation, MIMIC-IV, tên trạng thái.
- Số liệu luôn có **mẫu số và đơn vị**: "1000/1000 kết quả", "trung vị 0,97 giây". Không ghi "100%" trơn.
  Dùng dấu phẩy thập phân kiểu Việt Nam trong câu văn (0,97 giây); trong bảng giữ như file nguồn cũng được.
- Không phóng đại, không suy rộng: chỉ kết luận trong phạm vi dữ liệu, cấu hình, một máy tính.
  Phân biệt rõ "đã đo được" và "nhận định/suy luận".
- Bảng không quá 6 cột. Mỗi bảng/biểu đồ có 1–2 câu "đọc bảng này thế nào".

Ví dụ:
- ❌ "Hệ thống hoạt động hoàn hảo với độ chính xác 100%, chứng minh giải pháp vượt trội."
- ✅ "Cả 1000/1000 kết quả đều được lưu ở EMR, gắn đúng bệnh nhân và khớp đáp án ở mọi trường được kiểm tra.
     Kết quả này chỉ phản ánh bộ dữ liệu và cấu hình thử nghiệm trên một máy tính."

### 6.2 Bố cục (giữ đúng thứ tự, đánh số như dưới)

```
# Báo cáo kết quả thực nghiệm – Trao đổi kết quả xét nghiệm LIS → EMR qua FHIR R4
(đợt chạy <ngày>, commit <hash ngắn>)

## 0. Đọc nhanh
   5–8 gạch đầu dòng, mỗi gạch 1 kết luận chính KÈM CON SỐ. Gạch cuối: số ca không như kỳ vọng và ý nghĩa.

## 1. Thực nghiệm kiểm tra điều gì
   Bảng: Kịch bản (E1, E1A, E2, E3, E4, test tự động, FHIR) | Câu hỏi nó trả lời (nói thường) | Mã trong báo cáo giữa kỳ (TC01–TC07) | Chỉ số (M…)

## 2. Môi trường và dữ liệu
   2.1 Máy và phần mềm (từ 00-moi-truong.txt; thêm cấu hình thử lại 2/4/8 s, lease 15 s, quét 1 s)
   2.2 Dữ liệu: 1.000 kết quả MIMIC-IV Demo 2.2 / 100 bệnh nhân / 5 loại xét nghiệm, trong đó 40 kết quả lõi
       (tập lõi đã mô tả ở chương 2); các ca thử lỗi là bản sao có mã MUT-… và được đánh dấu synthetic.
   2.3 Cách bảo đảm khách quan: môi trường riêng dựng lại sạch cho mỗi nhóm kịch bản; bộ đáp án độc lập
       (spp65-v2, lập riêng với code chuyển đổi); ảnh chụp DB trước/sau; mã SHA-256 cho mọi file minh chứng.

## 3. Cách tiến hành
   Mỗi kịch bản 3–5 câu: mục đích – làm gì – kỳ vọng gì. Không dán lệnh (lệnh nằm trong script, chỉ ghi tên script).

## 4. Kết quả từng kịch bản
   4.1 E1 – 1.000 kết quả hợp lệ   4.2 E1A – độ trễ khi gửi từng kết quả   4.3 E2 – sai bệnh nhân, dữ liệu sai
   4.4 E3 – gửi trùng   4.5 E4 – thành phần tạm ngừng   4.6 TC06, TC07 qua test tự động   4.7 Cấu trúc FHIR
   Mỗi mục: bảng kết quả gọn (lấy từ TONG_HOP_SO_LIEU.md) → 2–4 câu nhận xét → dòng "Minh chứng:" liệt kê đường dẫn file.
   Chèn biểu đồ bằng ![...](bieu-do/....png) ở 4.1, 4.2, 4.5, kèm câu chú thích dạng "Hình 3.x – ...".

## 5. Tổng hợp chỉ số M1–M13
   Bảng: Chỉ số | Ý nghĩa (nói thường) | Kết quả | Đạt kỳ vọng? | Ghi chú.
   Kỳ vọng theo kế hoạch: M1 = 100%, M2 = 100%, M4 = 0, M5 = 0, M6 = 0. M7 báo theo từng nhóm ngoại lệ.
   M9–M12 không có ngưỡng (chương 2 không đặt ngưỡng) → chỉ mô tả, không kết luận đạt/không đạt.

## 6. Những điểm không như kỳ vọng và nguyên nhân
   Mỗi ca KHÔNG ĐẠT: hiện tượng (kèm số) → nguyên nhân dựa trên dữ liệu (trích file/dòng) → mức ảnh hưởng →
   hướng xử lý đề xuất (nói rõ đây là đề xuất, chưa thực hiện). Nếu không có ca nào thì ghi rõ "không có".

## 7. Giới hạn của thực nghiệm
   Tối thiểu: một máy tính; dữ liệu MIMIC-IV đã khử định danh; trạng thái FINAL và múi giờ UTC là giả định mô phỏng;
   mã xét nghiệm là mã cục bộ (chưa LOINC/UCUM); thời gian phụ thuộc chu kỳ quét hàng đợi 1 giây; khi dồn 1.000 kết quả
   thời gian chủ yếu là xếp hàng; TC06, TC07 chứng minh bằng test tự động chứ không tạo lỗi thật; chưa đánh giá bảo mật,
   tải lớn, vận hành dài ngày. Thêm giới hạn nào phát sinh trong lần chạy (ghi trong TIEN_DO.md).

## 8. Gợi ý đưa vào Chương 3
   Gợi ý bảng/hình nào đặt ở mục nào của chương 3 (3.x), câu chú thích mẫu cho từng bảng/hình.
   Lưu ý: Phụ lục 1.3 chương 2 ghi lease 10 s – giá trị thực khi chạy là 15 s.

## 9. Danh mục minh chứng
   Bảng: Đường dẫn file | Chứa gì | Dùng cho mục nào. Kèm hướng dẫn kiểm tra lại:
   `cd thuc-nghiem/ket-qua/<ngày> && sha256sum -c MINH_CHUNG_SHA256.txt`

## Phụ lục – Các lệnh đã chạy và các lần sửa script (nếu có)
```

Gợi ý phân tích (để khỏi phải đọc nhiều code):
- Khi dồn 1.000 kết quả, so các cột trong `E1-1000-ket-qua/thoi-gian-tung-chang.csv` (dùng `awk`/`python3` tính trung vị từng cột)
  để chỉ ra chặng nào làm thời gian tăng dần (nút thắt), rồi đối chiếu với cấu hình "quét hàng đợi mỗi 1 s".
- Với ca KHÔNG ĐẠT, nếu cần tìm nguyên nhân trong code thì chỉ `grep -n` có mục tiêu
  (ví dụ `grep -rn "test_code\|accepted_units" backend/src/middleware backend/src/emr`), không mở cả file dài.
  Ghi rõ đâu là điều đã thấy trong code, đâu là suy luận.

Độ dài mục tiêu: 4–8 trang khi in. Viết xong thì đọc lại một lượt, đối chiếu từng con số với `TONG_HOP_SO_LIEU.md`.

## 7. Định dạng `TIEN_DO.md`

```
# Tiến độ thực nghiệm – <ngày>
| Giờ | Bước | Trạng thái | Ghi chú ngắn |
|---|---|---|---|
| 23:10 | 00 | xong | stack demo đã tạm dừng |
| 23:12 | 01 | đang chạy nền | |
...
## Lựa chọn/sửa đổi đã làm
- ...
## Việc cần người dùng làm khi quay lại
- ... (ví dụ: push nhánh, cài java nếu bước 07 bị bỏ)
```

## 8. Kết thúc

Khi xong bước 09, in ra màn hình (ngắn gọn): đường dẫn báo cáo, số phép kiểm tra đạt/tổng, các ca không đạt (1 dòng mỗi ca),
nhánh git đã commit, và việc người dùng cần làm tiếp (push nhánh cho bạn cùng nhóm).
