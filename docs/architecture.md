# Kiến trúc & Tổ chức mã nguồn

Tài liệu này giúp các thành viên trong nhóm hiểu nhanh **mã nguồn được sắp xếp ở đâu** và **khi cần làm tính năng thì sửa file nào**.

---

## 1. Mô hình tổng thể

Dự án gồm **3 dịch vụ backend độc lập** và **1 ứng dụng frontend**, đặt chung trong cùng repository:

```text
[LIS] ──(HTTP)──> [Middleware] ──(HTTP / FHIR R4)──> [EMR]
  │                     │                              │
  └───────── PostgreSQL dacn_db (3 schema riêng) ──────┘
```

- **LIS (cổng 3101):** Quản lý dữ liệu xét nghiệm gốc.
- **Middleware (cổng 3102):** Nhận kết quả từ LIS, chuyển đổi sang chuẩn FHIR R4, gửi sang EMR và xác minh lại.
- **EMR (cổng 3103):** Tiếp nhận dữ liệu chuẩn FHIR và lưu trữ vào hồ sơ bệnh án.
- **Frontend (cổng 5173):** Giao diện web cho người dùng (nằm tại thư mục `frontend/`).

---

## 2. Cấu trúc thư mục `backend/`

Toàn bộ mã nguồn backend nằm trong thư mục `backend/src/`:

```text
backend/src/
├── common/           # Kết nối database dùng chung, không chứa logic nghiệp vụ
├── lis/              # Toàn bộ mã nguồn của dịch vụ LIS
├── middleware/       # Toàn bộ mã nguồn của dịch vụ Middleware
└── emr/              # Toàn bộ mã nguồn của dịch vụ EMR
```

Mỗi dịch vụ sẽ gồm các file với vai trò rõ ràng:

- `main.ts`: Khởi động dịch vụ và mở cổng HTTP.
- `controller.ts`: Tiếp nhận HTTP request và trả kết quả phản hồi (hiện có `/health` và `/ready`).
- `db.ts`: Cấu hình kết nối PostgreSQL riêng cho dịch vụ (gọi qua hàm chung tại `common/database.ts`).
- `schema.ts`: Khai báo bảng bằng TypeScript với Drizzle ORM để thao tác dữ liệu.
- `service.ts` *(sẽ thêm khi code nghiệp vụ)*: Viết logic xử lý chính (kiểm tra điều kiện, chuyển đổi dữ liệu).
- `repository.ts` *(sẽ thêm khi code nghiệp vụ)*: Viết các câu lệnh đọc/ghi database qua Drizzle.
- `dispatcher.ts` *(phía LIS)*: Tự động quét các kết quả đã duyệt để gửi sang Middleware.
- `worker.ts` *(phía Middleware)*: Quét giao dịch chờ xử lý, chuyển sang FHIR, gửi sang EMR và đối chiếu kết quả.

> **Quy tắc tạo file:** Chỉ tạo file khi thực sự bắt đầu làm tính năng đó, không cần tạo sẵn các file rỗng nếu chưa dùng.

---

## 3. Các quy tắc cần nhớ khi làm việc

1. **Không gọi chéo file giữa các dịch vụ:** Ví dụ LIS không import file của EMR hay Middleware. Ba bên chỉ trao đổi dữ liệu với nhau qua HTTP.
2. **Không dùng chung quyền database:** Mỗi dịch vụ chỉ đọc/ghi trên schema được phân quyền tương ứng (xem chi tiết tại [database.md](database.md)).
3. **Không gộp tất cả vào một file:** Controller chỉ nhận và trả HTTP, logic xử lý để ở Service, truy vấn database để ở Repository.
4. **Thay đổi database phải sửa file SQL trước:** Nguồn tạo bảng gốc là file trong `database/`. Khi đổi bảng, hãy sửa file SQL trước rồi mới cập nhật `schema.ts` tương ứng trong backend.
5. **Cập nhật tài liệu và kiểm tra lại:** Khi thêm hoặc đổi API, nhớ đối chiếu với [api-contract.md](api-contract.md).

---

## 4. Các luồng xử lý chính trong đồ án

- **Lưu trước khi gửi (Outbox tại LIS):** Khi bác sĩ duyệt (Publish) kết quả xét nghiệm, LIS lưu sự kiện vào bảng `publish_events` trước. Tiến trình gửi (`dispatcher.ts`) sẽ tự động đọc bảng này để gửi sang Middleware, tránh việc mất dữ liệu khi mạng bị lỗi.
- **Xác minh 2 bước (Middleware):** Middleware nhận dữ liệu, chuyển sang FHIR Observation rồi gửi sang EMR. Sau khi gửi, Middleware phải gọi đọc lại kết quả từ EMR để đối soát. Khi EMR lưu đúng và đủ thì Middleware mới đánh dấu là `DELIVERED`.
- **Đánh giá độc lập (Evaluator):** Là công cụ chạy riêng để so sánh dữ liệu giữa 3 hệ thống (LIS gốc, gói tin FHIR và dữ liệu EMR), không can thiệp vào luồng chạy chính.

---

## 5. Quy trình thêm một chức năng mới

Ví dụ khi bắt đầu làm tính năng duyệt gửi kết quả xét nghiệm tại LIS:

1. Đọc [api-contract.md](api-contract.md) để thống nhất cấu trúc request / response.
2. Tạo file `backend/src/lis/service.ts` để viết logic kiểm tra (kết quả đã hợp lệ chưa, đã gửi trước đó chưa).
3. Tạo file `backend/src/lis/repository.ts` để ghi dữ liệu vào bảng `lis.publish_events`.
4. Bổ sung endpoint trong `backend/src/lis/controller.ts` để gọi Service.
5. Chạy lệnh kiểm tra:
   ```bash
   cd backend
   npm run check    # Kiểm tra TypeScript
   npm run smoke    # Kiểm tra API
   ```
