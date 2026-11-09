# Entry point LIS · Flow Console

Cổng dev 5173 / preview 4173. Đây là giao diện Google Stitch dùng chung với hai entry point còn lại; không còn trang LIS legacy.

`src/App.tsx` và `src/flow/` chứa Flow Console. Giữ API client LIS, Publish, bộ lọc/phân trang FINAL, hook `useLisResults`, kiểu dữ liệu và proxy bảo toàn định danh. Các URL cũ tự chuyển về `/#/flow`.

Trong thư mục `frontend`: `npm.cmd run dev:lis`, `npm.cmd run build:lis`.
Kiểm thử trình duyệt: `node apps/lis/tests/browser-flow.mjs`, thêm `--dev` hoặc `--real` khi cần.

Xem [hướng dẫn chung](../../README.md) và [báo cáo kiểm thử](../../STITCH_REDESIGN.md).
