# Entry point LIS · Flow Console

Cổng dev 5173 / preview 4173. Đây là giao diện Google Stitch dùng chung với hai entry point còn lại; không còn trang LIS legacy.

`src/App.tsx` và `src/flow/` chứa Flow Console. Giữ API client LIS, Publish, bộ lọc/phân trang FINAL, hook `useLisResults`, kiểu dữ liệu và proxy bảo toàn định danh. Các URL cũ tự chuyển về `/#/flow`.

Trong thư mục `frontend`: `npm.cmd run dev:lis`, `npm.cmd run build:lis`.
Kiểm thử trình duyệt: `node apps/lis/tests/browser-flow.mjs`, thêm `--dev` hoặc `--real` khi cần.

Xem [hướng dẫn chung](../../README.md) và [báo cáo kiểm thử](../../STITCH_REDESIGN.md).

Nếu danh sách tải được nhưng tìm kiếm báo HTTP 400, kiểm tra phản hồi của
`/api/lis/results?search=100142&result_status=FINAL&limit=11&offset=0`.
Lỗi `VALIDATION_ERROR` với message `Unsupported result query parameter` có thể
do container LIS vẫn dùng image cũ, chưa hỗ trợ `search`. Chạy từ gốc repository
để build source hiện tại và cập nhật riêng dịch vụ LIS:

```sh
docker compose build lis
docker compose up -d --no-deps lis
```

`docker compose restart lis` chỉ khởi động lại container hiện tại, không cập nhật
mã trong image. Các lệnh trên không xóa database hoặc volume. Sau khi cập nhật,
thử tìm mã kết quả hoặc mã bệnh nhân, rồi xóa từ khóa để kiểm tra danh sách được
khôi phục. Danh sách này chỉ hiển thị kết quả `FINAL`.
