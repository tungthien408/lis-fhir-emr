/** Mô tả các API LIS đang có để Swagger UI hiển thị và gửi yêu cầu thử. */
import type { OpenAPIV3 } from "openapi-types";

const dispatchStatuses = ["PENDING", "IN_FLIGHT", "RETRY_WAIT", "ACK", "BLOCKED", "FAILED"];
const resultId: OpenAPIV3.ParameterObject = {
  name: "resultId", in: "path", required: true,
  description: "Mã kết quả. Có thể dùng A3-DEMO-R1 sau khi thêm dữ liệu giả theo hướng dẫn A3.",
  schema: { type: "string", minLength: 1 }, example: "A3-DEMO-R1",
};

function response(description: string, schemaName: string): OpenAPIV3.ResponseObject {
  return { description, content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaName}` } } } };
}

function error(description: string, code: string): OpenAPIV3.ResponseObject {
  return {
    ...response(description, "ApiError"),
    content: { "application/json": {
      schema: { $ref: "#/components/schemas/ApiError" }, example: { error: { code, message: description } },
    } },
  };
}

const badRequest = error("Tham số không hợp lệ.", "VALIDATION_ERROR");
const notFound = error("Không tìm thấy bản ghi.", "NOT_FOUND");
const unavailable = error("Chưa thể làm việc với database. Hãy thử lại sau.", "DEPENDENCY_UNAVAILABLE");
const publishProperties: Record<string, OpenAPIV3.SchemaObject> = {
  event_id: { type: "string", format: "uuid" },
  result_id: { type: "string", example: "A3-DEMO-R1" },
  dispatch_status: { type: "string", enum: dispatchStatuses, example: "PENDING" },
  exchange_id: { type: "string", format: "uuid", nullable: true, example: null },
};

export const lisOpenApiDocument: OpenAPIV3.Document = {
  openapi: "3.0.3",
  info: {
    title: "LIS — Thử API",
    version: "1.0.0",
    description: "Chọn API → Try it out → nhập thông tin → Execute. "
      + "GET dùng để xem, POST dùng để yêu cầu Publish. "
      + "Publish lưu kết quả để chờ gửi, chưa gửi sang Middleware hoặc EMR. "
      + "Ví dụ A3-DEMO-R1/R2 cần được thêm vào database test theo hướng dẫn A3 trước khi thử.",
  },
  // Relative root keeps Try it out on the same host and port as the open UI.
  servers: [{ url: "/", description: "Server LIS đang mở" }],
  tags: [
    { name: "Kết quả xét nghiệm", description: "Xem và lọc dữ liệu nguồn." },
    { name: "Publish", description: "Chốt kết quả để chờ gửi và xem sự kiện đã lưu." },
    { name: "Kiểm tra hệ thống", description: "Kiểm tra server và kết nối database." },
  ],
  paths: {
    "/api/results": {
      get: {
        tags: ["Kết quả xét nghiệm"], operationId: "listResults", summary: "Xem danh sách kết quả",
        description: "Có thể bỏ trống bộ lọc. Nếu dùng nhiều bộ lọc, kết quả phải thỏa tất cả điều kiện. "
          + "Danh sách sắp theo result_id. Tham số lặp hoặc không được hỗ trợ sẽ bị từ chối.",
        parameters: [
          { name: "patient_id", in: "query", description: "Mã bệnh nhân; bỏ trống nếu không lọc.", schema: { type: "string", minLength: 1 } },
          { name: "test_code", in: "query", description: "Mã xét nghiệm; bỏ trống nếu không lọc.", schema: { type: "string", minLength: 1 } },
          { name: "result_status", in: "query", description: "Trạng thái kết quả.", schema: { type: "string", enum: ["READY", "FINAL"] } },
          { name: "limit", in: "query", description: "Số kết quả muốn lấy (1–100).", schema: { type: "integer", minimum: 1, maximum: 100, default: 20 } },
          { name: "offset", in: "query", description: "Số kết quả bỏ qua từ đầu.", schema: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER, default: 0 } },
        ],
        responses: { "200": response("Danh sách kết quả, có thể rỗng.", "ResultList"), "400": badRequest, "503": unavailable },
      },
    },
    "/api/results/{resultId}": {
      get: {
        tags: ["Kết quả xét nghiệm"], operationId: "getResultById", summary: "Xem một kết quả",
        parameters: [resultId],
        responses: { "200": response("Kết quả xét nghiệm.", "LabResult"), "400": badRequest, "404": notFound, "503": unavailable },
      },
    },
    "/api/results/{resultId}/publish": {
      post: {
        tags: ["Publish"], operationId: "publishResult", summary: "Publish kết quả",
        description: "Chỉ kết quả FINAL hợp lệ mới được Publish lần đầu. Không cần nhập body. "
          + "Lần đầu trả 202; cùng snapshot trả 200 với sự kiện cũ, khác nội dung trả 409 CONTENT_CONFLICT. PENDING nghĩa là đang chờ gửi. "
          + "A3-DEMO-R1 (FINAL) thử thành công và A3-DEMO-R2 (READY) trả 422, nhưng hai mã này chỉ có sau khi thêm dữ liệu giả theo hướng dẫn A3; trong DB seed MIMIC hãy dùng một result_id có thật lấy từ GET /api/results. "
          + "Nếu kết quả đã Publish bị đổi nội dung hoặc quay về READY, Publish lại trả 409 CONTENT_CONFLICT (không phải 422).",
        parameters: [resultId],
        responses: {
          "202": response("Đã lưu sự kiện mới, đang chờ gửi.", "PublishResult"),
          "200": response("Trả lại sự kiện cũ, không tạo thêm hoặc đặt lại trạng thái.", "PublishResult"),
          "409": error("Nội dung nguồn khác snapshot đã phát hành; giữ nguyên event cũ.", "CONTENT_CONFLICT"),
          "400": badRequest, "404": notFound,
          "422": error("Kết quả chưa đủ điều kiện Publish (FINAL, đơn vị, số liệu hoặc thời gian).", "RESULT_NOT_READY"),
          "413": error("JSON gửi kèm vượt giới hạn 1mb.", "VALIDATION_ERROR"),
          "415": error("Cách mã hóa body không được hỗ trợ.", "VALIDATION_ERROR"),
          "503": unavailable,
        },
      },
    },
    "/api/results/{resultId}/publish-event": {
      get: {
        tags: ["Publish"], operationId: "getResultPublishState", summary: "Tra cứu Publish theo mã kết quả (chỉ đọc)",
        description: "200 published=false/event=null khi chưa Publish; 404 nếu kết quả không tồn tại. Không tạo hoặc reset event; không nhận query.",
        parameters: [resultId],
        responses: { "200": response("Nguồn và event đã lưu, hoặc event=null.", "ResultPublishState"),
          "400": badRequest, "404": notFound, "503": unavailable },
      },
    },
    "/api/publish-events/{eventId}": {
      get: {
        tags: ["Publish"], operationId: "getPublishEventByEventId", summary: "Xem sự kiện Publish",
        parameters: [{
          name: "eventId", in: "path", required: true,
          description: "Dán event_id nhận từ phản hồi Publish. UUID minh họa không có sẵn trong database.",
          schema: { type: "string", format: "uuid", pattern: "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$" },
        }],
        responses: { "200": response("Trạng thái và số lần gửi đã lưu.", "PublishEvent"), "400": badRequest, "404": notFound, "503": unavailable },
      },
    },
    "/health": {
      get: {
        tags: ["Kiểm tra hệ thống"], operationId: "health", summary: "Server HTTP có đang chạy không?",
        description: "Có thể thử ngay, không cần database.",
        responses: { "200": response("Server đang chạy.", "Health") },
      },
    },
    "/ready": {
      get: {
        tags: ["Kiểm tra hệ thống"], operationId: "ready", summary: "Database đã sẵn sàng chưa?",
        description: "Kiểm tra kết nối, tài khoản và các bảng LIS. Chưa cấu hình database thì trả 503.",
        responses: { "200": response("Database sẵn sàng.", "Readiness"), "503": response("Database chưa sẵn sàng.", "Readiness") },
      },
    },
  },
  components: {
    schemas: {
      LabResult: {
        type: "object",
        required: ["result_id", "patient_id", "test_code", "test_name", "fluid", "category", "value_num", "unit", "reference_low", "reference_high", "effective_at", "result_status"],
        properties: {
          result_id: { type: "string", example: "A3-DEMO-R1" },
          patient_id: { type: "string", example: "A3-DEMO-P1" },
          test_code: { type: "string", example: "A3-DEMO-T1" },
          test_name: { type: "string", example: "Synthetic test" },
          fluid: { type: "string", nullable: true, example: "Blood" },
          category: { type: "string", nullable: true, example: "Chemistry" },
          value_num: { type: "string", example: "3.4000", description: "API xem trả dạng chữ để giữ nguyên độ chính xác." },
          unit: { type: "string", example: "mg/dL" },
          reference_low: { type: "string", nullable: true, example: "1.2000" },
          reference_high: { type: "string", nullable: true, example: null },
          effective_at: { type: "string", format: "date-time", nullable: true, example: "2026-10-22T08:00:00.123456Z", description: "Giờ UTC giữ đủ phần giây; null nếu nguồn không có thời điểm ISO hợp lệ." },
          result_status: { type: "string", enum: ["READY", "FINAL"], example: "FINAL" },
        },
      },
      ResultList: {
        type: "object", required: ["items", "limit", "offset"],
        properties: {
          items: { type: "array", items: { $ref: "#/components/schemas/LabResult" } },
          limit: { type: "integer", minimum: 1, maximum: 100, example: 20 },
          offset: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER, example: 0 },
        },
      },
      PublishResult: { type: "object", required: Object.keys(publishProperties), properties: publishProperties },
      PublishEvent: {
        type: "object", required: [...Object.keys(publishProperties), "dispatch_attempt_count", "last_error_code", "last_error_message"],
        properties: {
          ...publishProperties,
          dispatch_attempt_count: { type: "integer", minimum: 0, example: 0 },
          last_error_code: { type: "string", nullable: true, example: null },
          last_error_message: { type: "string", nullable: true, example: null, description: "Thông báo chung, không chứa lỗi SQL hoặc thông tin kết nối." },
        },
      },
      ResultPublishState: {
        type: "object", required: ["result_id", "result_status", "published", "event"],
        properties: {
          result_id: { type: "string" }, result_status: { type: "string", enum: ["READY", "FINAL"] },
          published: { type: "boolean" },
          event: { type: "object", nullable: true,
            required: [...Object.keys(publishProperties), "dispatch_attempt_count", "last_error_code", "last_error_message", "published_at", "acked_at", "next_retry_at"],
            properties: { ...publishProperties,
              dispatch_attempt_count: { type: "integer", minimum: 0 },
              last_error_code: { type: "string", nullable: true }, last_error_message: { type: "string", nullable: true },
              published_at: { type: "string", format: "date-time" }, acked_at: { type: "string", format: "date-time", nullable: true },
              next_retry_at: { type: "string", format: "date-time", nullable: true },
            } },
        },
      },
      ApiError: {
        type: "object", required: ["error"],
        properties: { error: {
          type: "object", required: ["code", "message"],
          properties: { code: { type: "string" }, message: { type: "string" } },
        } },
      },
      Health: {
        type: "object", required: ["service", "status"],
        properties: { service: { type: "string", enum: ["lis"] }, status: { type: "string", enum: ["ok"] } },
      },
      Readiness: {
        type: "object", required: ["service", "status", "schema"],
        properties: {
          service: { type: "string", enum: ["lis"] }, schema: { type: "string", enum: ["lis"] },
          status: { type: "string", enum: ["ready", "not_configured", "unavailable", "schema_incomplete", "wrong_role", "unsafe_permissions"] },
          database: { type: "string", example: "dacn_db" }, role: { type: "string", example: "lis_app" },
          missing_tables: { type: "array", items: { type: "string" } },
          unexpected_schemas: { type: "array", items: { type: "string" } }, message: { type: "string" },
        },
      },
    },
  },
};
