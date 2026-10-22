import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Phần dùng chung CHỈ để mở kết nối và kiểm tra database.
 * Không chứa logic LIS / Middleware / EMR, không truy cập chéo schema.
 */
export function createDatabaseConnection(options: {
  service: string;
  schema: "lis" | "integration" | "emr";
  envName: string;
  expectedRole: string;
  expectedTables: readonly string[];
}) {
  const url = process.env[options.envName]?.trim();
  const pool = url
    ? new Pool({
        connectionString: url,
        max: 3,
        connectionTimeoutMillis: 3000,
        idleTimeoutMillis: 10000,
      })
    : null;

  // Sự cố khi một kết nối đang rảnh bị đóng không được làm sập cả HTTP server.
  pool?.on("error", () => {
    console.error(`[${options.service}] Ket noi PostgreSQL bi gian doan.`);
  });

  // Repository sẽ sử dụng biến db này khi nhóm bắt đầu viết nghiệp vụ.
  const db = pool ? drizzle({ client: pool }) : null;

  async function check(): Promise<{
    status: "ready" | "not_configured" | "unavailable" | "schema_incomplete" | "wrong_role" | "unsafe_permissions";
    database?: string;
    role?: string;
    schema: string;
    missing_tables?: string[];
    unexpected_schemas?: string[];
    message?: string;
  }> {
    if (!pool || !db) {
      return {
        status: "not_configured",
        schema: options.schema,
        message: `Chua khai bao ${options.envName} trong .env`,
      };
    }

    try {
      // Câu đầu chạy qua Drizzle để kiểm tra chính kết nối ORM.
      const result = await db.execute(sql`SELECT current_database() AS db_name, current_user AS db_role`);
      const first = result.rows[0] as { db_name?: string; db_role?: string } | undefined;
      const database = first?.db_name ?? "unknown";
      const role = first?.db_role ?? "unknown";

      // Chỉ hỏi danh sách bảng trong schema của service đang chạy.
      const tablesResult = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
        [options.schema],
      );
      const present = new Set(tablesResult.rows.map((row) => row.table_name));
      const missing = options.expectedTables.filter((name) => !present.has(name));

      if (role !== options.expectedRole) {
        return {
          status: "wrong_role",
          schema: options.schema,
          database,
          role,
          message: `Can dung PostgreSQL role ${options.expectedRole} cho ${options.service}`,
        };
      }

      const otherSchemas = ["lis", "integration", "emr"].filter((name) => name !== options.schema);
      const access = await pool.query<{ schema_name: string }>(
        `SELECT nspname AS schema_name FROM pg_namespace
         WHERE nspname = ANY($1::text[]) AND has_schema_privilege(nspname, 'USAGE')`,
        [otherSchemas],
      );
      if (access.rows.length > 0) {
        return {
          status: "unsafe_permissions",
          schema: options.schema,
          database,
          role,
          unexpected_schemas: access.rows.map((row) => row.schema_name),
          message: "Role nay co quyen USAGE tren schema cua service khac",
        };
      }

      if (database !== "dacn_db" || missing.length > 0) {
        return {
          status: "schema_incomplete",
          schema: options.schema,
          database,
          role,
          missing_tables: missing,
          message: database !== "dacn_db" ? "Khong ket noi vao dacn_db" : "Thieu bang hoac quyen doc bang",
        };
      }

      return { status: "ready", schema: options.schema, database, role };
    } catch {
      // Không đưa lỗi driver ra HTTP: lỗi có thể chứa thông tin kết nối nhạy cảm.
      return {
        status: "unavailable",
        schema: options.schema,
        message: "Khong ket noi duoc PostgreSQL; kiem tra URL, tai khoan, port va database.",
      };
    }
  }

  async function close(): Promise<void> {
    await pool?.end();
  }

  return { db, check, close };
}
