# Entry point EMR · Flow Console

Cổng dev 5175 / preview 4175. `src/App.tsx` re-export Flow Console từ LIS. Không còn màn tìm kiếm/hồ sơ/chi tiết EMR legacy; các URL cũ chuyển về `/#/flow`.

Giữ `src/api/emr.ts`, kiểu dữ liệu và validator định danh để đọc kết quả, bệnh nhân và kiểm tra liên kết trong Flow Console. Không thay đổi API hoặc dữ liệu EMR.

Trong thư mục `frontend`: `npm.cmd run dev:emr`, `npm.cmd run build:emr`.
Kiểm thử: `node apps/lis/tests/browser-flow.mjs --app=emr`; thêm `--dev` để chạy trên 5175.

Xem [hướng dẫn chung](../../README.md) và [báo cáo kiểm thử](../../STITCH_REDESIGN.md).
