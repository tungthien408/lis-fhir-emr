# Frontend LIS – Middleware Monitor – EMR

Ba ứng dụng React + TypeScript + Vite độc lập, quản lý bằng npm workspaces trong thư mục `frontend/`. Workspace là một gói npm con được quản lý cùng các gói khác từ thư mục cha.

Ứng dụng LIS đã được bổ sung màn hình danh sách ở Giai đoạn 2.1. Xem [hướng dẫn và kết quả kiểm tra LIS](apps/lis/README.md). Các mục Giai đoạn 1 bên dưới ghi nhận đợt chuyển đổi cấu trúc trước đó.

## Phạm vi giai đoạn 1

- Di chuyển nguyên trạng ứng dụng thử nghiệm LIS vào `apps/lis/`.
- Tạo trang giới thiệu bằng tiếng Việt cho Middleware Monitor và EMR.
- Mỗi ứng dụng có điểm khởi động React, cấu hình Vite, cổng và bản build riêng.
- Chỉ dùng chung cấu hình Vite thực sự cần cho cả ba ứng dụng tại `config/vite.ts`.
- Chưa cần tạo gói trong `packages/`; chưa bổ sung thư viện giao diện hoặc chức năng nghiệp vụ.

## Cấu trúc

```text
frontend/
├── apps/
│   ├── lis/
│   │   ├── public/
│   │   ├── src/                # Mã nguồn và CSS LIS được bảo toàn
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig*.json
│   │   ├── vite.config.ts
│   │   └── dist/               # Sinh ra khi build LIS
│   ├── middleware-monitor/
│   │   ├── src/                # Trang giới thiệu, chưa gọi API nghiệp vụ
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig*.json
│   │   ├── vite.config.ts
│   │   └── dist/               # Sinh ra khi build Monitor
│   └── emr/
│       ├── src/                # Trang giới thiệu, chưa gọi API nghiệp vụ
│       ├── index.html
│       ├── package.json
│       ├── tsconfig*.json
│       ├── vite.config.ts
│       └── dist/               # Sinh ra khi build EMR
├── config/
│   └── vite.ts                 # Proxy và cấu hình máy chủ dùng chung
├── eslint.config.js
├── package.json
├── package-lock.json
└── README.md
```

Mỗi ứng dụng khai báo React và React DOM trong `dependencies`. Công cụ phát triển như Vite, TypeScript và ESLint nằm trong `devDependencies` của workspace cha. Cài dependency tại `frontend/` trước khi chạy các ứng dụng. Không cần khởi chạy hai ứng dụng còn lại để chạy hoặc build một ứng dụng.

## Cài đặt

Yêu cầu Node.js tương thích các thư viện hiện có; môi trường kiểm tra giai đoạn này dùng Node.js `24.11.0` và npm `11.12.1`.

Từ thư mục gốc repository:

```powershell
cd frontend
npm ci
```

`npm ci` cài theo tệp khóa chung. Không cần chạy `npm install` riêng trong từng ứng dụng. Tệp khóa giữ nguyên phiên bản tất cả dependency đã có trước khi chuyển đổi.

Trên PowerShell, có thể dùng `npm.cmd` thay `npm` nếu chính sách thực thi chặn `npm.ps1`.

## Chạy từng ứng dụng

Đứng tại `frontend/`, chạy mỗi lệnh trong một terminal riêng:

| Ứng dụng | Lệnh | Địa chỉ phát triển |
|---|---|---|
| LIS | `npm run dev:lis` | <http://127.0.0.1:5173> |
| Middleware Monitor | `npm run dev:monitor` | <http://127.0.0.1:5174> |
| EMR | `npm run dev:emr` | <http://127.0.0.1:5175> |

`npm run dev` vẫn mở LIS để giữ cách chạy quen thuộc của bản thử nghiệm. Dừng từng ứng dụng bằng `Ctrl+C`.

Cả ba dùng `strictPort: true`: nếu cổng bị chiếm, lệnh báo lỗi thay vì tự chọn cổng khác. Kiểm tra tiến trình đang dùng cổng trước khi chạy; chỉ dừng tiến trình mà mình quản lý.

Có thể chạy trực tiếp theo workspace:

```powershell
npm run dev --workspace apps/lis
npm run dev --workspace apps/middleware-monitor
npm run dev --workspace apps/emr
```

## Build và xem trước

Build là quá trình kiểm tra TypeScript và đóng gói mã nguồn thành các tệp phục vụ trình duyệt.

| Ứng dụng | Lệnh build | Đầu ra | Lệnh xem trước | Cổng xem trước |
|---|---|---|---|---:|
| LIS | `npm run build:lis` | `apps/lis/dist/` | `npm run preview:lis` | 4173 |
| Middleware Monitor | `npm run build:monitor` | `apps/middleware-monitor/dist/` | `npm run preview:monitor` | 4174 |
| EMR | `npm run build:emr` | `apps/emr/dist/` | `npm run preview:emr` | 4175 |

- `npm run build`: build lần lượt cả ba ứng dụng.
- `npm run preview`: xem trước bản build LIS.
- Chạy build ứng dụng tương ứng trước khi dùng lệnh xem trước.
- Các cổng xem trước cũng bật `strictPort` và có cùng proxy API.
- `preview` dùng để kiểm tra bản build tại máy cá nhân. Khi triển khai thực tế, cần máy chủ phục vụ tệp tĩnh và cấu hình proxy riêng.

## Kiểm tra mã nguồn

```powershell
# Kiểm tra TypeScript của cả ba ứng dụng và cấu hình Vite được import
npm run check

# Kiểm tra ESLint cả frontend, bao gồm cấu hình dùng chung
npm run lint

# Kiểm tra ESLint của từng workspace
npm run lint --workspace apps/lis
npm run lint --workspace apps/middleware-monitor
npm run lint --workspace apps/emr

# Kiểm tra TypeScript của một ứng dụng
npm run check --workspace apps/lis
```

Các lệnh được chạy từ `frontend/`. Mỗi ứng dụng cũng có các script `dev`, `build`, `check`, `lint`, `preview` trong `package.json` riêng.

## Kết nối backend

Proxy là thành phần nhận yêu cầu từ trình duyệt rồi chuyển tiếp tới backend. Cả ba ứng dụng dùng chung các quy tắc sau, giữ nguyên tham số truy vấn:

| Đường dẫn frontend | Backend trên máy cá nhân | Đường dẫn backend |
|---|---|---|
| `/api/lis/...` | `http://127.0.0.1:3101` | `/api/...` |
| `/api/middleware/...` | `http://127.0.0.1:3102` | `/api/...` |
| `/api/emr/...` | `http://127.0.0.1:3103` | `/api/...` |

Ví dụ LIS gọi `/api/lis/results?limit=11&offset=0`; Vite chuyển tiếp đến `http://127.0.0.1:3101/api/results?limit=11&offset=0`.

Cấu hình này dành cho frontend chạy trực tiếp trên host, gọi các cổng backend Docker đã công bố. Không sửa backend để xử lý CORS. Proxy này không ánh xạ `/health` hoặc `/ready`; kiểm tra hai endpoint đó trực tiếp tại địa chỉ backend khi cần.

Nếu LIS báo lỗi tải dữ liệu, kiểm tra backend LIS đang hoạt động và truy cập được ở cổng 3101. Hai trang giới thiệu Monitor và EMR chưa gửi yêu cầu API nghiệp vụ.

## Các tệp đã chuyển đổi

| Nhóm | Thay đổi |
|---|---|
| Di chuyển nguyên trạng | `src/**`, `public/**`, `index.html`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json` từ frontend cũ sang `apps/lis/` |
| Di chuyển và điều chỉnh | `vite.config.ts` sang `apps/lis/vite.config.ts`, dùng cấu hình chung và cổng 5173/4173 |
| Tạo mới cho LIS | `apps/lis/package.json` |
| Tạo mới cho Monitor và EMR | Mỗi ứng dụng có `package.json`, `index.html`, `vite.config.ts`, ba `tsconfig*.json`, `src/main.tsx`, `src/App.tsx`, `src/index.css` |
| Tạo mới dùng chung | `config/vite.ts` |
| Cập nhật tại frontend cha | `package.json`, `package-lock.json`, `eslint.config.js`, `README.md` |

Thư mục `dist/` và `node_modules/` cũ tại frontend cha là sản phẩm sinh tự động, không phải mã nguồn được chuyển. Bản build mới nằm riêng trong mỗi ứng dụng. Không dùng lại `frontend/dist/` cũ.

## Chức năng LIS hiện tại – Giai đoạn 2.2

- Danh sách dùng GET với `limit=11`, hiển thị 10 dòng; dòng thứ 11 xác định có trang sau.
- Bộ lọc mã bệnh nhân, mã xét nghiệm, READY/FINAL; tách bản nháp và bộ lọc áp dụng.
- Hash routing lưu bộ lọc và trang trong URL, hỗ trợ F5 và Back/Forward.
- Màn hình chi tiết riêng gọi GET `/api/lis/results/<encodedResultId>`, đủ 12 trường, bố cục rộng/hẹp.
- Giữ chuỗi số/đơn vị, thời gian UTC và ISO gốc, nullable; hủy yêu cầu và chặn phản hồi cũ.
- Có trạng thái đang tải/rỗng/lỗi/thử lại, không triển khai Publish, Monitor hoặc EMR.

Xem [README LIS](apps/lis/README.md) để chạy kiểm thử và [báo cáo 2.2](apps/lis/tests/evidence/phase-2.2-2026-11-03/BAO_CAO.md) để xem bằng chứng mới. Phần kiểm tra ngày 02/11/2026 bên dưới là lịch sử chuyển đổi workspace, không mô tả trạng thái chức năng/nghiệm thu hiện tại.

## Kết quả kiểm tra ngày 02/11/2026

| Hạng mục | Kết quả thực tế |
|---|---|
| Kiểm tra trước khi di chuyển | Đúng nhánh `feature/frontend/lis-emr-ui`; working tree sạch; bản LIS được lưu ở commit `516b6d8` |
| Cài đặt workspace | `npm install --offline --ignore-scripts --no-audit --no-fund --cache node_modules/.cache/npm` thành công; thêm ba liên kết workspace |
| Cây dependency | `npm ls --workspaces --depth=0` nhận đủ ba ứng dụng; dùng chung React/React DOM 19.3.1 |
| Bảo toàn LIS | So SHA-256 trước/sau của cả 11 tệp trong `src/` và `public/`: trùng khớp toàn bộ |
| Phiên bản dependency | Đối chiếu tệp khóa trước/sau: không có dependency cũ đổi phiên bản |
| TypeScript | `npm run check` đạt cho cả ba ứng dụng |
| ESLint | `npm run lint` và `npm run lint --workspaces` đạt |
| Build riêng | `build:lis`, `build:monitor`, `build:emr` đều đạt |
| Các lệnh chạy | Chạy đồng thời `npm run dev:lis`, `npm run dev:monitor`, `npm run dev:emr`: đúng cổng và HTTP 200 |
| Chạy đồng thời bằng API Vite | Khởi động Vite bằng API Node cho cả ba ứng dụng trên 5173/5174/5175; HTML và các module `main.tsx`, `App.tsx` trả HTTP 200 |
| Hai trang giới thiệu | React dựng được nội dung tên Monitor và EMR khi kiểm tra kết xuất phía máy chủ; chưa kiểm tra trực quan bằng trình duyệt |
| Xung đột cổng phát triển | Thử khởi động Vite thứ hai trên từng cổng đang dùng: bị từ chối đúng với `strictPort` |
| Quy tắc proxy | Kiểm tra cả ba đích backend và cách viết lại đường dẫn/tham số trên từng ứng dụng: đạt |
| Xem trước bản build | Cả ba ứng dụng trả HTTP 200 trên 4173/4174/4175; tệp JavaScript và CSS của bản build truy cập được |
| API LIS thật | GET trực tiếp cổng 3101 không kết nối được, kể cả kiểm tra ngoài sandbox; GET qua proxy LIS trả 502. Chưa xác nhận lại dữ liệu thật sau chuyển đổi |

Lượt kiểm tra các lệnh chạy gặp lỗi quyền khi dọn tiến trình bằng `taskkill` trong sandbox. Sau khi được cấp quyền, đã xác minh và dừng đúng các tiến trình Vite kiểm thử thuộc frontend này. Kiểm tra lại cho thấy cả sáu cổng 5173–5175 và 4173–4175 đã được giải phóng. Không gửi POST, không thay đổi dữ liệu PostgreSQL, không khởi động lại backend và không tạo dữ liệu giả.

## Các điểm còn lại

- Cần chạy lại bước kiểm tra dữ liệu LIS khi backend tại `127.0.0.1:3101` truy cập được. Không dùng kết quả build hoặc HTTP 200 của trang để kết luận API đã trả dữ liệu thật.
- Chưa kiểm tra giao diện bằng trình duyệt; kiểm tra chạy hiện tại bao gồm HTTP, module, bản build và nội dung hai trang giới thiệu được React kết xuất.
- Các giới hạn của bản thử nghiệm LIS như xử lý `effective_at = null` và kiểu nullable được giữ nguyên để giới hạn giai đoạn này ở chuyển đổi cấu trúc.
- Cần cấu hình phục vụ tệp tĩnh và proxy khi triển khai thực tế; giai đoạn này chưa sửa Compose hoặc thêm hạ tầng triển khai.
- Không có thay đổi ngoài phạm vi `frontend/`; không bổ sung tính năng nghiệp vụ hay nâng cấp dependency.
