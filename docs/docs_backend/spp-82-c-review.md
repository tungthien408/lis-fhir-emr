# SPP-82-C — Kiểm chứng dữ liệu độc lập

Đã triển khai công cụ độc lập trong `backend/scripts/spp82/verification/`.
Phần này kiểm nguồn LIS, FHIR Middleware, bản ghi EMR và liên kết người bệnh
bằng đáp án đã khóa. Không dùng kết luận của Worker/82-B làm đáp án.
Chỉ thực hiện 82-C; chưa chạy thí nghiệm chính thức, chưa xác minh 1.000 giao dịch
thật, không sửa service, SQL schema hoặc dữ liệu SPP-65 gốc.

## Nguồn đáp án thực sự tìm thấy

Đã tìm trong repository, datasets và thư mục bàn giao được tài liệu import
chỉ ra tại `../dataset/DACN_Nap_LIS_pgAdmin/`; cũng liệt kê nội dung archive RAR.
Có `DAP_AN_DOC_LAP_1000.csv` và `DAP_AN_DOC_LAP_40.csv`. CSV 1.000 có các cột
MR01–MR09, expected EMR, UUID người bệnh, nguồn và provenance
`independent_raw_csv_not_mapper`. Liên kết namespace + patient ID → patient key
nằm trong SQL reference đã lưu Git. Không tìm thấy `manifest_1000.csv`, manifest
khóa/checksum gốc hoặc gói seed/oracle ZIP được biên bản bàn giao nhắc tới.

Vì vậy không tuyên bố đã có đủ bản khóa SPP-65 ban đầu. Đã thực hiện một bước
**khóa tham chiếu cục bộ riêng**, trước mọi phép so sánh actual:

1. Băm CSV bàn giao, hai SQL seed, `labevents.csv.gz` và `d_labitems.csv.gz`.
2. Python `csv`/`Decimal` kiểm toàn bộ 1.000 ID, số dòng nguồn, bệnh nhân,
   mã/display/context, số, đơn vị, cận, thời điểm, trạng thái quy ước và mọi cột
   MR/expected EMR của CSV đáp án với CSV gốc và catalog.
3. Kiểm tập ID và các trường LIS với SQL seed được pin checksum. SQL được phân
   tích literal, **không thực thi**. Kiểm 100 liên kết namespace chính xác với
   bảng bệnh nhân LIS/EMR trong SQL reference.
4. Sao chép nguyên byte CSV bàn giao, xuất `expected.jsonl`, `patient-links.json`,
   `rules.json`, `manifest.json` và checksum vào
   `backend/scripts/spp82/reference/spp65-v2/`. Không đọc actual FHIR/EMR khi làm bước này.

Kết quả offline: đủ 1.000 ID duy nhất, 1.000 dòng nguồn khớp, 100 liên kết khớp;
không phát hiện sai lệch trong các trường đã kiểm. Đây là kiểm tra **đáp án và
nguồn**, không phải kết quả giao dữ liệu sang EMR và không thay chữ ký nghiệm thu
của người sở hữu SPP-65.

| Đầu vào | SHA-256 |
|---|---|
| CSV đáp án bàn giao | `8e93c46edcab5a6d4e5d2e06fb8260958590a2b55c2242118fe89525e2fc318a` |
| Raw labevents.csv.gz | `d51a4cf1ea63245abe7d544b0d50a928e9ee2ec5eb9a5ce85500aed0bd6c6dfc` |
| Raw d_labitems.csv.gz | `72ea5f020469fd24543bd98ab3bd0a4f645a5a4b7802d9d52af20d736f9d76db` |
| SQL reference | `b66613cf2e1ed1f8d46ce6f0a0efc2efa976532e4e487bf6058ec43e835023e5` |
| SQL 1.000 kết quả | `28b21b4e19f1df9b79d8ee10944e33e1f1fe20c0045abfd5b5d3fbcd89644fe7` |
| Manifest tham chiếu cục bộ | `55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267` |

Nguồn MIMIC có charttime không mang timezone. UTC và FINAL là **giả định đã khai
báo của dự án**, được ghi trong provenance; không suy đoán múi giờ lâm sàng.
Không thêm LOINC hoặc đổi đơn vị. Script freeze có checksum riêng trong manifest.
Loader yêu cầu checksum manifest từ người gọi, kiểm lại checksum từng file,
provenance, đúng 1.000 ID, tính duy nhất và khớp patient-links. Không có tùy chọn
hạ xuống 40 hoặc bỏ qua hàng lỗi. Thiếu/sai oracle trả `NOT_VERIFIED`/exit 2;
không chuyển sang dùng Mapper hoặc giá trị EMR làm expected.

Để tái tạo tham chiếu ở thư mục **mới**, đọc lại CSV bàn giao mà không sửa nó:

```bash
python3 backend/scripts/spp82/verification/freeze-reference.py \
  --oracle-csv /duong-dan/DAP_AN_DOC_LAP_1000.csv \
  --oracle-sha256 8e93c46edcab5a6d4e5d2e06fb8260958590a2b55c2242118fe89525e2fc318a \
  --output /tmp/spp82-reference-new
```

Không chạy lại để ghi đè bản đã khóa. Nếu nguồn/quy tắc thay đổi, cần tạo phiên
bản tham chiếu mới và review sự khác biệt.

## Oracle độc lập và ranh giới các module

Oracle là đáp án thiết lập từ nguồn và quy tắc đã chốt **trước khi xem output
của hệ thống cần kiểm**. Nếu dùng production Mapper tạo expected rồi so với
chính output Mapper, cùng một lỗi có thể xuất hiện ở cả hai bên và vẫn PASS.
82-C không import Mapper, `verifyReadBack`, repository hoặc controller production.

| Module | Trách nhiệm |
|---|---|
| `freeze-reference.py` | Kiểm chéo raw/seed/CSV bàn giao và khóa tham chiếu, hoàn toàn offline |
| `expected-loader.ts` | Kiểm checksum/provenance/population/link của đáp án |
| `exact-values.ts` | Decimal, instant và JSON parser giữ nguyên numeric token, độc lập production |
| `evidence-collector.ts` | SELECT qua từng role đúng schema, snapshot read-only |
| `evidence-loader.ts` | Đọc evidence JSON, journal 82-B hoặc output gốc 82-A |
| `source-target-comparator.ts` | MR01–MR09, FHIR subset, cardinality và chứng minh thuộc run |
| `comparison-report.ts` | Per-field/per-result JSONL, thống kê và Markdown tái lập |
| `verification-main.ts` | CLI verify offline hoặc capture chủ động |

Đã đọc ba Schema, API contract, architecture/database, seed README/SQL,
Mapper/Worker verification, D3 harness và artifact A/B. Giữ nguyên các thay đổi
82-A/82-B đang có; chỉ thêm npm scripts cho C và mở rộng test glob.

## Đọc dữ liệu thật theo quyền hiện có

Kiến trúc có `evaluator_app` được cấp SELECT ba schema, nhưng công cụ này chọn
**ba connection riêng** dùng `lis_app`, `integration_app`, `emr_app` và chỉ đọc
schema của chính role đó. Không cấp thêm quyền, không dùng postgres/superuser,
không SET ROLE và không ghi bảng experiment/field_comparisons; báo cáo ra file.

Collector yêu cầu cấu hình chủ động:

- `LIS_VERIFY_DATABASE_URL`, `MIDDLEWARE_VERIFY_DATABASE_URL`, `EMR_VERIFY_DATABASE_URL`.
- `SPP82_VERIFICATION_ISOLATION_TOKEN`: UUID của harness PostgreSQL cô lập đã
  được phê duyệt. Cả ba connection phải đến cùng host/port/database `dacn_db`.
- Sau `BEGIN ... REPEATABLE READ READ ONLY`, kiểm current_user, database,
  transaction_read_only và database comment `spp66-disposable:<token>` theo guard
  D3 hiện có. Không đúng thì không SELECT dữ liệu nghiệp vụ.

Cấu hình này không tự tạo harness, không sửa comment database để vượt guard và
không tự lấy URL từ `.env` của service. Chỉ khi có harness được phê duyệt mới
thực hiện capture thật. Lần triển khai này **chỉ kiểm collector bằng reader giả**.

Mọi query đều cố định, parameterized, có timeout. NUMERIC cast `::text`, instant
`to_char(... at time zone 'UTC', ...US...)`, JSONB FHIR cast `::text`. Như vậy
không mất microsecond qua pg/JS Date hoặc mất chữ số qua JSON.parse.
Collector đọc nguồn LIS cùng catalog, publish events, exchange FHIR và SEND
receipts, kết quả EMR, patient_links và sự tồn tại của patient_key chuẩn.
Lỗi đọc/guard trả table `unavailable`, không thay bằng mảng rỗng.

Phạm vi snapshot gồm namespace của dự án và toàn bộ ID chuẩn; EMR còn lấy
các target_id do SEND receipts chỉ ra để phát hiện đích bị đổi external_id.
Các hàng demo cũ ngoài tập expected vẫn có thể nằm trong namespace snapshot;
chúng không được mặc nhiên tính là extra của run mới.
Snapshot repeatable-read riêng mỗi service **không phải một snapshot đồng thời
xuyên ba connection**. Nên thu sau khi pipeline ổn định trong harness; bất nhất
đọc giữa các lần capture phải xem lại evidence, không chữa bằng cách bỏ trường.

## Nội dung đối chiếu và độ chính xác

Mỗi result so nguồn LIS trực tiếp với frozen expected, đối chiếu cả FHIR của
Middleware và FHIR lưu tại EMR, cùng các cột EMR:

- MR01: ID kết quả, namespace/value, ID nguồn MIMIC và seed tag.
- MR02: patient_id, subject type, namespace/value của patient identifier,
  **UUID expected đã khóa**, hàng patient_links và patient row tồn tại.
- MR03: mã xét nghiệm, namespace mã, tên/display.
- MR04–MR06: quantity, đơn vị, cận dưới/cận trên; phân biệt null và giá trị 0.
- MR07: instant xét nghiệm với đủ phần lẻ giây.
- MR08: nguồn FINAL, FHIR/EMR final.
- MR09: fluid/category nguồn, context và laboratory category.
- FHIR: resourceType, tất cả key/array của subset được hỗ trợ; thiếu/thừa coding,
  sai kiểu numeric, thừa meta/id hoặc referenceRange sai cấu trúc đều bị phát hiện.

Không tuyên bố validator HL7 FHIR tổng quát. Kiểm subset đúng contract dự án.

**Liên kết người bệnh:** `MIMIC-P-*` là mã LIS, UUID là patient_key của EMR.
Tra bằng **cả namespace và value** trong patient_links rồi so với UUID đã khóa,
đồng thời so patient_key thực sự ở lab_results. Đổi chéo người bệnh, thiếu link,
sai namespace hoặc FHIR subject sai đều có bằng chứng riêng. Không lấy receipt
hoặc chính patient_key hiện tại làm đáp án như một phép kiểm vòng tròn.

**Decimal:** `3.4000` và `34e-1` chuẩn hóa về cùng hệ số/số mũ; xử lý bằng chuỗi
và BigInt, không Number(), epsilon hoặc làm tròn. `3.40000000000000000000001`
khác `3.4`. Cột NUMERIC bắt buộc là chuỗi. Parser FHIR giữ nguyên token số từ
JSONB text, nên cũng phát hiện sai lệch vượt độ chính xác float. Trong báo cáo,
token được ghi dưới dạng `{"json_number":"3.40000000000000000000001"}` để audit;
đây là biểu diễn của evaluator, không phải FHIR JSON dùng trên wire.

**Timestamp:** thuật toán Gregorian tính ordinal/seconds và giữ nguyên phần
lẻ giây, trừ offset timezone. Hai cách viết cùng instant được chấp nhận;
`.123456` khác `.123455`. Không chuyển instant qua JS Date rồi mất microsecond.
Calendar/offset sai bị từ chối. UTC client và thời gian server không được dùng
để suy luận độ mới bằng phép trừ clock giữa các máy.

## Dữ liệu đúng có thuộc run hiện tại không?

DELIVERED chỉ cho biết Worker đã kiểm bằng logic nội bộ. Nó không chứng minh
đáp án nguồn đúng, liên kết bệnh nhân đúng hoặc hàng đích được tạo trong run này.

PASS đầy đủ cần:

1. Đúng một LIS result, đúng một exchange và đúng một hàng đích phù hợp.
2. Tất cả trường/structure khớp oracle; target_id không bị nhiều source sử dụng.
3. Record A/B có Publish NEW/HTTP 202 và event_id khớp publish event + exchange
   thực tế; exchange_id quan sát được nếu có cũng phải khớp.
4. Snapshot **before** cùng môi trường/tham chiếu chứng minh chưa có event,
   exchange hoặc đích của source đó; target_id cũng không tồn tại trong before.
5. SEND receipt đã lưu khớp external pair, UUID người bệnh expected và target_id.

`ALREADY_EXISTS` không tự động nghĩa là dữ liệu của run cũ: retry sau khi mất
response có thể nhận 200. Nếu before rỗng và chuỗi NEW event/receipt khớp, vẫn
có thể xác nhận thuộc run hiện tại. Ngược lại, có hàng/event từ before hoặc
Publish EXISTING → FAIL attribution; thiếu before/receipt/NEW event →
NOT_VERIFIED. Có thể các trường lâm sàng PASS nhưng kết quả chung NOT_VERIFIED.
Giả định phạm vi là harness cô lập, không có writer cạnh tranh cho cùng ID;
không dùng timestamp hoặc trạng thái DELIVERED để thay bằng chứng này.

Extra là chênh lệch namespace **after − before** nằm ngoài tập expected hoặc
ngoài tập selected của run khi biết đầy đủ selection. Hàng cũ ngoài run không
bị gọi nhầm là extra. Không có before thì không thể xác nhận delta. Một cặp
external ID xuất hiện nhiều hàng không bị gộp; hai source khác nhau có cùng giá
trị xét nghiệm vẫn là hai kết quả; hai source trỏ cùng target là lỗi.

Run timeout/partial vẫn dùng mẫu số 1.000. Nếu evidence sau timeout chứng minh
một kết quả đã lưu đúng và thuộc run, có thể PASS **data verification** cho hàng
đó, nhưng giữ measurement_outcome=timeout và không sửa latency/completion của
82-B. Hàng chưa có dữ liệu là missing; table không truy cập được là unverified.

## Artifact và cách diễn giải

Thư mục output phải mới, mode 0700; file 0600. Không log URL/mật khẩu/raw driver
error. Khác telemetry 82-B, báo cáo C có expected/actual giá trị xét nghiệm và
mã người bệnh theo yêu cầu audit; chỉ lưu trong artifact được quản lý quyền.
Không ghi tên người bệnh, comments nguồn hoặc payload ngoài phạm vi cần so.

- `field-comparisons.jsonl`: run_id, result_id, exchange_id nếu có, rule_id,
  field_path, expected, actual_fhir, actual_target, outcome và reason; thêm
  actual_source để thấy sai ở LIS. Key thiếu dùng `{absent:true}`, nguồn không
  áp dụng dùng `{not_applicable:true}`, không đọc được dùng `{not_verified:...}`.
- `per-result-verification.jsonl`: outcome, measurement_outcome và danh sách
  failed/unverified field paths theo result ID.
- `comparison-report.json`: checksum đầu vào, tổng expected=1.000, observed,
  matched/missing/duplicate/wrong-patient/field-mismatch/stale/reused-target,
  extra, unverified và PASS/FAIL/NOT_VERIFIED theo từng rule + field.
- `summary.md`: tóm tắt và giới hạn.

PASS = có bằng chứng đúng; FAIL = thấy sai lệch cụ thể; NOT_VERIFIED = chưa đủ
bằng chứng để kết luận. FAIL không tự chỉ ra lỗi nằm ở Mapper: đọc actual_source,
actual_fhir và actual_target để xác định nơi bắt đầu lệch. Lỗi current_run có
thể do dữ liệu cũ hoặc file evidence ghép nhầm, dù dữ liệu lâm sàng khớp.

`total_observed_results` là số hàng EMR trong phạm vi các ID chuẩn/receipt liên
quan; `observed_namespace_rows` gồm cả hàng khác trong namespace đã capture.
Table không đọc được → observed=null, không phải 0. Missing chỉ đếm khi đã đọc
thành công và thấy 0 hàng. Nhóm missing/field mismatch/unverified có thể giao
nhau; không cộng chúng thành tổng độc quyền. Match rate luôn matched/1000.
Không gộp cả lỗi kỹ thuật và dữ liệu thiếu thành PASS. Report không có timestamp
sinh mới ngẫu nhiên nên cùng frozen inputs tạo cùng nội dung từng byte.

## CLI và quy trình offline

Kiểm chứng từ artifact đã lưu, không gửi Publish hoặc truy cập DB:

```bash
cd backend
npm run spp82:verify -- \
  --oracle scripts/spp82/reference/spp65-v2/manifest.json \
  --oracle-sha256 55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267 \
  --run-dir /duong-dan/artifact-82b \
  --before /duong-dan/before.json \
  --after /duong-dan/after.json \
  --output /duong-dan/verification-moi
```

Có thể dùng `--publish-jsonl /duong-dan/output-82a.jsonl` thay `--run-dir`.
82-A không liệt kê đầy đủ các ID chưa schedule khi bị ngắt; công cụ ghi rõ
selection_complete=false và vẫn giữ expected population 1.000. 82-B được kiểm
selection hash; JSONL lấy snapshot hoàn chỉnh cuối mỗi ID, dòng cuối bị cắt
được ghi run incomplete. Không tin outcome completed làm kết luận correctness.

Capture chỉ dùng sau review trong harness PostgreSQL được phê duyệt; các lệnh
sau minh họa chức năng, **chưa được chạy lên DB thật ở lần triển khai này**:

```bash
# Cần cấu hình ba *_VERIFY_DATABASE_URL và isolation token của harness.
npm run spp82:capture -- \
  --oracle scripts/spp82/reference/spp65-v2/manifest.json \
  --oracle-sha256 55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267 \
  --phase before --output /duong-dan/before-moi.json

# Sau run được phê duyệt ở bước khác:
npm run spp82:capture -- \
  --oracle scripts/spp82/reference/spp65-v2/manifest.json \
  --oracle-sha256 55cb4256c77d731bff7e8ea1c1ad7f9788df889b4833d9a6b501282c169c7267 \
  --phase after --run-dir /duong-dan/artifact-82b \
  --output /duong-dan/after-moi.json
```

Before không cần run_id vì 82-A CLI sinh UUID khi chạy; snapshot có checksum
oracle, environment ID và toàn bộ namespace. After phải gắn run_id từ A/B.
Không thể bổ sung before một cách hồi tố sau workload rồi gọi đó là bằng chứng
trước run. Thiếu before giữ NOT_VERIFIED cho attribution.

Exit code: 0 PASS; 1 thấy FAIL; 2 NOT_VERIFIED hoặc input/guard không hợp lệ.
Không tự chạy workload để bù evidence thiếu. Báo cáo hiện trạng thiếu bằng chứng
thật được lưu ở [spp-82-c-missing-evidence/summary.md](spp-82-c-missing-evidence/summary.md).

## Kiểm thử và giới hạn còn lại

Unit tests dùng fixture tự viết, có literal FHIR riêng; không gọi production
Mapper để dựng expected. Test toàn bộ 1.000 hàng là **so sánh trong bộ nhớ bằng
dữ liệu giả**, không phải chạy Publish workload. Bao phủ các ca yêu cầu C01–C11,
đặc biệt độ chính xác > float/microsecond, namespace bệnh nhân, missing/duplicate,
old-run, timeout/partial và mẫu số đầy đủ. Reader PostgreSQL được inject để test
SQL projection, role boundary, READ ONLY và guard từ chối trước khi đọc.

Bằng chứng còn thiếu: chưa có before/after của một run SPP-82 thật, chưa chạy
collector bằng PostgreSQL cô lập thật, chưa có manifest khóa gốc/owner sign-off
SPP-65. Vì vậy không kết luận 1.000 giao dịch thật đã đúng hoặc hoàn tất. Không
thay đổi Jira, không commit/push, không bắt đầu 82-D; chờ review.

Kết quả kiểm tra thực tế ngày **02/11/2026**:

| Kiểm tra | Kết quả |
|---|---|
| `cd backend && npm run check` | PASS |
| `cd backend && npm run build` | PASS |
| `cd backend && npm run test:spp82:verify` | PASS, 40 test C |
| `cd backend && npm run test:spp82` | PASS, 47 test A + 24 test B + 40 test C = **111 test** |
| Tái chạy freeze vào thư mục tạm bằng CSV bàn giao và raw/seed đã pin | PASS, cả sáu file khớp byte với bản tham chiếu đã khóa |
| Test CLI verify offline hai lần với cùng artifact | PASS, cả bốn file báo cáo khớp byte |
| Kiểm thiếu oracle qua CLI | Exit 2, NOT_VERIFIED, mẫu số 1.000, không giả lập PASS |
| Kiểm reader sai role/isolation marker | Không SELECT bảng nghiệp vụ; trả unavailable |
| Kiểm import trong thư mục verification | Không import module production/Mapper/Worker verification |
| `git diff --check` và kiểm whitespace file mới | PASS |

Không có test bị skip. Loader tsx phát Node warning DEP0205 trong môi trường
hiện tại; các lệnh vẫn kết thúc thành công. PostgreSQL collector chưa được kiểm
bằng kết nối thật; đây là giới hạn được giữ rõ, không dùng số lượng unit test
để tuyên bố đã nghiệm thu tích hợp hoặc hoàn tất 1.000 kết quả thật.
