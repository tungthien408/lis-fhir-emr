# Frontend — Giao diện LIS & EMR

Thư mục chứa ứng dụng giao diện web cho hệ thống, được xây dựng bằng **React**, **TypeScript** và **Vite**.

---

## 1. Cài đặt và Khởi chạy

Yêu cầu môi trường: **Node.js 22+** và **npm**.

```bash
# Di chuyển vào thư mục frontend
cd frontend

# Cài đặt thư viện
npm install

# Khởi chạy giao diện ở chế độ phát triển
npm run dev
```

Sau khi chạy, mở trình duyệt tại địa chỉ: **[http://localhost:5173](http://localhost:5173)**.

---

## 2. Các lệnh thường dùng

```bash
npm run dev        # Chạy máy chủ phát triển (HMR)
npm run build      # Biên dịch mã nguồn cho bản xuất bản (production)
npm run preview    # Xem trước bản build production tại máy cá nhân
npm run lint       # Kiểm tra lỗi định dạng code bằng ESLint
```

---

## 3. Cấu trúc thư mục

```text
frontend/
├── src/
│   ├── assets/       # Hình ảnh, biểu tượng tĩnh
│   ├── App.tsx       # Component giao diện chính
│   ├── main.tsx      # Điểm nạp React vào DOM
│   ├── App.css       # Style cho App
│   └── index.css     # Style toàn cục
├── index.html        # Trang HTML chính của Vite
├── package.json      # Quản lý thư viện và script frontend
└── vite.config.ts    # Cấu hình Vite
```

---

## 4. Định hướng tích hợp

Trong các bước tiếp theo của đồ án, frontend sẽ kết nối tới các dịch vụ backend:
- Gọi API LIS (`http://127.0.0.1:3101`) để hiển thị danh sách xét nghiệm và kích hoạt duyệt gửi (Publish).
- Gọi API Middleware (`http://127.0.0.1:3102`) để xem nhật ký trao đổi và trạng thái gói tin FHIR.
- Gọi API EMR (`http://127.0.0.1:3103`) để tra cứu hồ sơ kết quả xét nghiệm của bệnh nhân.
