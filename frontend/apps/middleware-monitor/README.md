# Entry point Middleware Monitor · Flow Console

Cổng dev 5174 / preview 4174. `src/App.tsx` re-export Flow Console từ LIS. Không còn màn lịch sử/chi tiết giao dịch legacy; các URL cũ chuyển về `/#/flow`.

Giữ `src/api/exchanges.ts`, kiểu dữ liệu, validator định danh và nhãn chẩn đoán mà Flow Console sử dụng. Không thay đổi endpoint, hợp đồng dữ liệu hoặc logic xác minh DELIVERED.

Trong thư mục `frontend`: `npm.cmd run dev:monitor`, `npm.cmd run build:monitor`.
Kiểm thử: `node apps/lis/tests/browser-flow.mjs --app=middleware-monitor`; thêm `--dev` để chạy trên 5174.

Xem [hướng dẫn chung](../../README.md) và [báo cáo kiểm thử](../../STITCH_REDESIGN.md).
