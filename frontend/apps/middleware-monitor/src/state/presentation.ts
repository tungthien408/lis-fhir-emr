import type { Status } from '../types/exchange.ts'
export const statusLabels: Record<Status, string> = {
  RECEIVED: 'Đã tiếp nhận',
  PROCESSING: 'Đang xử lý / gửi',
  VERIFYING: 'Đang xác minh EMR',
  RETRY_WAIT: 'Chờ thử lại tự động',
  DELIVERED: 'MW báo DELIVERED',
  REJECTED: 'Đã từ chối',
  FAILED: 'Xử lý thất bại',
}
export const diagnosticLabels: Record<string, string> = {
  HTTP_TIMEOUT: 'Quá thời gian chờ EMR; xem pha và lịch thử lại.',
  NETWORK_ERROR: 'Không kết nối được EMR; kiểm tra dịch vụ và mạng.',
  HTTP_TEMPORARY: 'EMR trả lỗi tạm thời; xem lịch thử lại và trạng thái cuối.',
  HTTP_PERMANENT: 'EMR trả lỗi không được thử lại tự động; cần kiểm tra cấu hình/yêu cầu.',
  DUPLICATE_CONFLICT: 'Định danh hoặc nội dung xung đột tại EMR; không ghi đè bản đã lưu.',
  REMOTE_VALIDATION_ERROR: 'EMR từ chối dữ liệu; cần kiểm tra nguồn và ánh xạ.',
  INVALID_SOURCE: 'Dữ liệu nguồn không hợp lệ hoặc không khớp định danh/hash.',
  MAPPING_UNSUPPORTED: 'Dữ liệu chưa được hỗ trợ trong ánh xạ FHIR.',
  PAYLOAD_INTEGRITY: 'Payload đã lưu không còn nhất quán; cần kiểm tra dữ liệu.',
  STORAGE_RECEIPT_MISSING: 'Thiếu receipt lưu hợp lệ; chưa xác minh EMR.',
  INVALID_STORAGE_RESPONSE: 'Phản hồi lưu EMR không hợp lệ; chưa thể xác nhận lưu.',
  INVALID_VERIFY_RESPONSE: 'Phản hồi đọc lại không hợp lệ; chưa đối soát được.',
  VERIFY_MISMATCH: 'Dữ liệu đọc lại không khớp; không xác nhận DELIVERED.',
  LEASE_EXPIRED: 'Lượt xử lý bị gián đoạn; kết quả từ xa có thể chưa rõ.',
  RETRY_EXHAUSTED: 'Đã hết lượt thử tự động; cần nhóm vận hành kiểm tra.',
  DIAGNOSTIC_ERROR: 'Mã chẩn đoán đã được làm an toàn; cần nhóm vận hành kiểm tra.',
}
