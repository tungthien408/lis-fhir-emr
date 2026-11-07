# SPP-82-B — Đo tiến độ và hiệu năng quan sát được

Chỉ triển khai 82-B. Chưa thực hiện 82-C/82-D, chưa chốt protocol chính thức,
chưa chạy workload thật hoặc đưa ra kết luận hiệu năng. Không đổi service,
schema hay database. Các artifact trong [ví dụ](spp-82-b-example/summary.md)
**hoàn toàn là dữ liệu mô phỏng**, không phải số liệu thí nghiệm.

## Preflight và cách ghép với 82-A

Đã đọc API contract, architecture, ba Controller/Schema, Worker,
`worker-verification.ts`, D3 e2e/harness và package scripts.
82-A hiện chọn `FINAL` theo seed tag `DACN-MIMIC22-SOURCE-ALIGNED-V2`, yêu cầu
đủ 1.000 hàng nguồn trước khi áp dụng `--limit`, sắp `result_id ASC`; không
chọn hàng demo. Giữ nguyên truy vấn nguồn và các thay đổi chưa commit.

82-A mặc định dry-run; Publish thật cần `--confirm-publish` và
`SPP82_EXPERIMENT_TARGET`. 82-B dùng lại nguyên bộ guard và `runPublishWorkload`,
không tự POST Middleware/EMR. Dry-run không mở phiên đo, không tạo artifact đo.
`concurrency` vẫn là số **HTTP Publish** đang chạy, không phải số giao dịch
end-to-end. Pool observer độc lập có giới hạn riêng; một lượt poll mỗi kết quả
chạy LIS → Middleware → EMR tuần tự. Các kết quả trong pool được phân phối
bằng hàng đợi, không tạo 1.000 request đồng thời.

CLI/output cũ giữ nguyên khi không bật `SPP82_MEASURE=1`. Chỉ sửa scheduler
82-A để tránh vòng lặp khi signal đã abort trước khi seed slot, và đợi tất cả
request đang chạy trả về khi shutdown; không còn ghi record sau báo cáo cuối.

## Các mốc có ý nghĩa khác nhau

| Mốc | Bằng chứng | Có phải hoàn tất? |
|---|---|---|
| Publish | HTTP 202: LIS lưu event mới | Chưa |
| Publish lại | HTTP 200: event đã có | Không tính giao dịch mới |
| ACK | GET publish event báo ACK và có exchange UUID | Chưa |
| DELIVERED | GET đúng exchange báo Worker đã lưu và đọc lại EMR đúng | Cần client đọc lại thêm |
| Read-back client | Đúng một hàng của cặp external_system/external_id; đối chiếu MR01–MR09 thành công | Có, nếu là Publish mới |

Mỗi kết quả giữ `result_id → event_id → exchange_id`. GET sai định danh hoặc
trạng thái ngoài contract chỉ là lỗi quan sát, không được nhận là giao dịch đó.
LIS `PENDING/IN_FLIGHT/RETRY_WAIT` và Middleware
`RECEIVED/PROCESSING/VERIFYING/RETRY_WAIT` là tạm thời. LIS `BLOCKED/FAILED`,
Middleware `REJECTED/FAILED` là lỗi terminal. `VALIDATED/SENT/TARGET_STORED` là
mốc history, không phải trạng thái chính. Giữ counters dispatch/send/verify,
retry phase và lịch sử trạng thái mà API công khai; không suy ra mọi retry từ
một snapshot. Polling có thể bỏ lỡ các trạng thái diễn ra giữa hai lượt.

LIS GET hiện **không** công khai timestamp publish/ACK/retry hoặc lịch sử attempts;
server_times tương ứng là null. Middleware GET công khai counters/history và
các timestamp nhưng không trả attempts.response_body hoặc mã lỗi chi tiết terminal.
Không bịa receipt, timestamp, error message hay số worker từ giá trị mặc định.
Journal lưu mã lỗi LIS được allowlist, không lưu arbitrary error message.

## Read-back và giới hạn về đáp án độc lập

Namespace đích là `https://example.org/lis/result`, không phải `lis-demo`.
Query gửi cả `external_system` và `external_id`, không phân trang và không lọc
bớt hàng trùng. HTTP 200 với items rỗng chưa đạt; nhiều hơn một hàng là
`DUPLICATE_DESTINATION_ROWS`; mismatch là lỗi kiểm tra của client, không tự kết
luận trạng thái service FAILED.

Observer map lại **snapshot bất biến của exchange**, đối chiếu FHIR đã lưu tại
Middleware, rồi gọi lại `verifyReadBack` hiện có cho các cột và FHIR EMR.
Giữ so sánh NUMERIC chính xác bằng chuỗi, instant tới phần lẻ microsecond,
subject identifier, laboratory category, null cận và FHIR nguyên gốc.
Không dùng bản ghi LIS hiện tại thay snapshot đã Publish; không ghi payload vào
artifact. Đây là cách tái dùng mapping/checker, không phải evaluator độc lập.

API GET exchange không công khai receipt POST EMR. Client chỉ xác nhận UUID
`target_id/patient_key` hợp lệ từ hàng đang nhìn thấy để dùng checker;
**không thể đối chiếu hai UUID đó độc lập với receipt**. Bằng chứng đối chiếu
receipt vẫn đến từ Worker đã báo DELIVERED; không đổi hay nới kiểm tra production.
82-C phải độc lập đối chiếu tập kết quả/đáp án nguồn, đúng người bệnh trong
patient_links, đủ và duy nhất hàng đích, MR01–MR09/FHIR, provenance và chống trùng;
không lấy trạng thái DELIVERED hoặc mapping của chính hệ thống làm đáp án duy nhất.

## Đồng hồ, latency, percentile và throughput

Các mốc client gồm `publish_request_start`, `publish_response`,
`lis_ack_observed`, `middleware_delivered_observed`, `emr_readback_observed`,
`terminal_failure_observed`. Mỗi mốc có UTC audit và `elapsed_ms` từ **cùng một
origin monotonic**. `publish_response` được ghi khi hàm HTTP đã đọc xong response;
lỗi mạng không có mốc này. Timestamps server nằm riêng trong observations.server_times.

Publish latency = publish_response.elapsed_ms − publish_request_start.elapsed_ms.
Đây chỉ là thời gian API Publish. Latency chính =
emr_readback_observed.elapsed_ms − publish_request_start.elapsed_ms,
chỉ cho Publish NEW, đã có ACK, DELIVERED và client read-back đúng.
Không trừ UTC giữa máy LIS/Middleware/EMR hoặc giữa server với client.
Đồng hồ UTC có thể bị chỉnh NTP; monotonic dùng đo khoảng thời gian nên không
bị nhảy khi đồng hồ lịch thay đổi. `stored_at` không thay thế mốc client:
nó thuộc clock EMR, chưa chứng minh thời điểm dữ liệu được client nhìn thấy.

Polling làm tăng latency quan sát: gồm chờ lượt poll, hàng đợi pool, HTTP và
so sánh. `polling_interval_ms` là thời gian nghỉ sau mỗi vòng sweep, **không phải
cam kết mỗi kết quả được poll chính xác sau từng khoảng đó**. Một giao dịch có
thể phải chờ nhiều vòng ACK/DELIVERED/read-back. Sai số không được đảm bảo chỉ
bằng một polling interval, nhất là khi nhiều hàng hoặc endpoint chậm.
Số millisecond thập phân không có nghĩa đo chính xác microsecond khi poll mỗi giây.

Đặt N = toàn bộ `result_ids` đã chọn trước POST; C = số hoàn tất hợp lệ:

- completion_count = C.
- failure_count = service_failure + publish_rejected + measurement_failure;
  ba nhóm cũng xuất riêng, không đồng nghĩa tất cả là service lỗi.
- timeout_count = số hàng chưa xác định kết quả cuối khi deadline run hết.
- completion_rate = C / N; N = 0 trả null.
- total_elapsed_seconds = (ended.elapsed_ms − started.elapsed_ms) / 1000.
- throughput_results_per_second = C / total_elapsed_seconds; thời gian 0 hoặc
  chưa có ended trả null.
- p50/p95: sắp tăng latency của **chỉ C hàng hoàn tất**; nearest-rank lấy phần tử
  thứ ceil(p × C), chỉ số bắt đầu 1. Ví dụ 20 mẫu 10,20,…,200 ms: p50 = 100,
  p95 = 190 ms. Không có mẫu trả null.

Biên throughput bắt đầu ngay trước mở artifact và phát hành request đầu; kết
thúc sau publish đã drain và tất cả kết quả hoàn tất/được phân loại, hoặc deadline/
shutdown kết thúc. Bao gồm queue Publish, polling, kết quả chậm và thời gian chờ
hết deadline; không chia C chỉ cho khoảng gửi HTTP hoặc tổng latency. Không
bao gồm discovery DB, parse cấu hình, hay ghi metrics/summary cuối cùng.

HTTP 200 Publish cũ ở `existing_count`, vẫn trong N nhưng không vào C hoặc
percentile. Thiếu event ID là measurement_failure. Thiếu exchange ID sau ACK
được ghi và chờ đến deadline, không bịa UUID. Publish mất response, 408/429/5xx
là unknown vì có thể đã lưu; không tự retry POST. Publish 4xx từ chối rõ ràng
(trừ 408/429) là publish_rejected. Timeout, interrupted, pending hoặc unknown
là censored; không được biến thành zero-ms success. partial_run báo C khác N.
`stop_reason=completed` nghĩa tiến trình đã phân loại xong, không phải mọi hàng
thành công; phải xem completion_count, partial_run và từng outcome.

## Artifact, metadata và dùng lại

Mở thư mục **mới** trước mọi POST; thư mục đã có bị từ chối để giữ bằng chứng.
Quyền mặc định directory 0700/file 0600. Xuất:

- `run-manifest.json`: version, run_id, scenario, selected IDs/hash, manifest_hash,
  concurrency và ý nghĩa, observer concurrency, worker counts, cấu hình service,
  timeout/polling, Git HEAD nếu lấy được, start/end và stop_reason.
- `per-result.jsonl`: journal append-only, mỗi dòng là snapshot của một kết quả;
  dòng hoàn chỉnh cuối cho mỗi ID là trạng thái mới nhất. Mọi trạng thái/mốc,
  HTTP status, lỗi allowlist, counters và server timestamps quan sát được được giữ.
- `metrics.json` và `summary.md`: metrics dẫn xuất và diễn giải ngắn.

Metadata không biết ghi null (scenario thiếu ghi `unspecified`), không suy từ
Compose mặc định hoặc env của client rằng service đang chạy đúng cấu hình đó.
Caller TypeScript có thể truyền `workerCounts` và `serviceConfiguration` đã kiểm
tra trong harness. CLI nhận khai báo counts và manifest hash, không tự chứng
thực chúng. Git HEAD không mô tả hết thay đổi chưa commit; cần lưu checkout
riêng khi thiết kế protocol ở bước sau.
Không ghi connection string, URL credential, bệnh nhân, kết quả xét nghiệm,
source/FHIR payload hoặc raw error bodies. Record IDs/hash là metadata cần
thiết cho đối chiếu, vẫn nên quản lý artifact theo quyền truy cập dữ liệu dự án.

SIGINT/SIGTERM dừng scheduling, abort HTTP, đợi request đang chạy kết thúc và
xuất các hàng chưa hoàn tất là interrupted. SIGKILL/mất điện không chạy cleanup:
manifest còn ended=null/stop_reason=null, replay phát hiện incomplete_artifact,
giữ N kể cả hàng chưa có journal. Có thể bỏ dòng cuối JSONL bị cắt; dòng hỏng ở
giữa file báo lỗi. Không đoán thời gian kết thúc; throughput null nếu thiếu ended.
Journal dùng ghi đồng bộ; không cam kết fsync chống mất dữ liệu do lỗi ổ đĩa.

Tính lại offline (không HTTP/DB, không sửa bằng chứng):

```bash
cd backend
node --import tsx scripts/spp82/recalculate-metrics.ts ../docs/docs_backend/spp-82-b-example
```

Sinh ví dụ khác, chỉ clock/HTTP mô phỏng, dùng thư mục chưa tồn tại:

```bash
node --import tsx scripts/spp82/simulated-example.ts /tmp/spp82-b-example-new
```

Cấu hình đo qua cùng entry point 82-A, dành cho harness cô lập được phê duyệt
sau review; đây **không** là yêu cầu chạy thí nghiệm ngay:

| Biến | Ý nghĩa / mặc định |
|---|---|
| SPP82_MEASURE | `1` bật 82-B |
| MIDDLEWARE_BASE_URL, EMR_BASE_URL | origin HTTP(S), bắt buộc khi bật đo |
| SPP82_SCENARIO | nhãn `SPP-73-pilot` hoặc `SPP-82-...`, chưa chốt protocol |
| SPP82_POLL_MS | 1000 ms |
| SPP82_RUN_TIMEOUT_MS | 120000 ms, toàn run |
| SPP82_OBSERVER_CONCURRENCY | 2, tối đa 10 |
| SPP82_ARTIFACT_DIR | thư mục mới; mặc định spp82-{runId} |
| SPP82_MANIFEST_HASH | SHA-256 manifest nguồn nếu đã có, thiếu = null |
| SPP82_DECLARED_DISPATCHER_COUNT, SPP82_DECLARED_WORKER_COUNT | counts đã được kiểm tra bởi người chạy, thiếu = null |

`--http-timeout-ms`, `--mode`, `--concurrency`, `--limit` và guard 82-A tiếp tục
áp dụng. Khi bật đo, artifact directory thay output JSONL cũ qua `--output`;
stdout trả đường dẫn artifact và metrics. Pilot có thể dùng `--limit` trên
cùng bộ nguồn đã xác thực. Hàm runner cũng nhận danh sách nguồn đã được harness
xác thực, không bắt buộc giả định 1.000 hàng để tính metrics. Không chạy bản
đầy đủ 1.000 kết quả trong lần triển khai này.

## Kiểm tra

Test mô phỏng không mở HTTP listener, không khởi động service/worker, không
kết nối database. Dùng fixture giả D3 làm đáp án cố định, clock và HTTP injection.
Bao phủ full success, ACK chưa delivery, delivery qua nhiều poll, read-back rỗng/
trùng/sai số thập phân, terminal LIS/Middleware, poll lỗi, mất phản hồi Publish,
missing IDs, Publish cũ, percentile/throughput và mẫu số hỗn hợp, clock skew,
thiếu/đảo mốc, shutdown/drain, journal replay/hard kill và artifact không lộ payload.

Kết quả thực tế ngày 02/11/2026:

| Lệnh / bộ kiểm tra | Kết quả |
|---|---|
| `cd backend && npm run check` | PASS |
| `cd backend && npm run build` | PASS |
| `cd backend && npm run test:spp82` | PASS cả hai file; 24 test 82-B + 47 test 82-A |
| `node --import tsx --test tests/middleware/worker.unit.test.ts tests/middleware/mapper.test.ts` (trong backend) | PASS; 7 + 23 test |
| Sinh hai bộ artifact mô phỏng ở thư mục tạm rồi so từng byte | PASS, cả 4 file giống nhau |
| Replay JSONL ví dụ và so với metrics.json | PASS |
| `git diff --check` | PASS |

Tổng 101 test unit/regression qua; không bỏ qua test. Môi trường này báo Node
deprecation warning DEP0205 của loader tsx, không làm fail kiểm tra. Chưa chạy
integration với service thật vì lần này chỉ dùng mô phỏng, không sử dụng harness
DB cô lập đã được phê duyệt. Không thay thế bằng cách chạy lên database đang có.
Không commit/push; chờ review trước khi tiếp tục bước khác.
