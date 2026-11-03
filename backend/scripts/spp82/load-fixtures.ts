/**
 * SPP-82-A: Khám phá và xác thực danh sách kết quả LIS đủ điều kiện để Publish.
 *
 * Nguồn duy nhất: cơ sở dữ liệu LIS thực tế qua PostgreSQL read-only.
 * Tiêu chí lọc:
 *   - provenance->>'seed_tag' = 'DACN-MIMIC22-SOURCE-ALIGNED-V2'
 *   - result_status = 'FINAL'
 *
 * Module này KHÔNG:
 *   - Tạo hoặc chèn dữ liệu mới.
 *   - Truy cập schema Middleware hoặc EMR.
 *   - Bao gồm hàng demo hiện có (chúng không có seed_tag MIMIC đúng).
 *
 * Thứ tự truy vấn tất định: ORDER BY result_id ASC (cùng thứ tự với
 * listResults của Repository LIS). Đây đảm bảo thứ tự thử nghiệm có thể
 * tái tạo lại giữa các lần chạy.
 *
 * Bộ thử nghiệm hợp lệ phải có đúng 1,000 result_id duy nhất.
 */
import { Client } from "pg";
import { EXPECTED_RESULT_COUNT, SEED_TAG } from "./load-config.js";

/** Thông tin tối thiểu của một kết quả đủ điều kiện. */
export interface EligibleResult {
  /** Mã định danh kết quả LIS (primary key). */
  resultId: string;
  /** Mã định danh bệnh nhân LIS (chỉ dùng để kiểm tra nội bộ, không log ra). */
  patientId: string;
  /** Mã xét nghiệm. */
  testCode: string;
}

export class FixtureError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "SEED_ABSENT"
      | "COUNT_MISMATCH"
      | "DUPLICATE_IDS"
      | "DATABASE_ERROR",
  ) {
    super(message);
    this.name = "FixtureError";
  }
}

/**
 * Truy vấn read-only để lấy danh sách result_id đủ điều kiện từ LIS.
 *
 * Yêu cầu: biến môi trường LIS_DATABASE_URL đã được đặt với kết nối
 * đến schema lis (dùng role lis_app hoặc readonly tương đương).
 *
 * Trả lỗi FixtureError nếu:
 * - Không tìm thấy bất kỳ kết quả nào (bộ seed chưa được nạp).
 * - Số lượng không khớp EXPECTED_RESULT_COUNT = 1,000.
 * - Có result_id bị trùng.
 *
 * @param databaseUrl  URL kết nối PostgreSQL (mặc định process.env.LIS_DATABASE_URL).
 * @param limit        Giới hạn tùy chọn (chỉ dùng trong dry-run để preview).
 */
export async function discoverEligibleResults(
  databaseUrl: string = process.env.LIS_DATABASE_URL ?? "",
  limit?: number,
): Promise<EligibleResult[]> {
  if (!databaseUrl) {
    throw new FixtureError(
      "LIS_DATABASE_URL environment variable is required to discover eligible results",
      "DATABASE_ERROR",
    );
  }

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();

    // Truy vấn read-only; không có INSERT/UPDATE/DELETE.
    const { rows } = await client.query<{
      result_id: string;
      patient_id: string;
      test_code: string;
      total: string;
    }>(
      `
      SELECT
        result_id,
        patient_id,
        test_code,
        COUNT(*) OVER () AS total
      FROM lis.results
      WHERE
        result_status = 'FINAL'
        AND provenance->>'seed_tag' = $1
      ORDER BY result_id ASC
      `,
      [SEED_TAG],
    );

    if (rows.length === 0) {
      throw new FixtureError(
        `No FINAL results found with seed_tag = '${SEED_TAG}'. ` +
          "The 1,000-row MIMIC dataset may not have been seeded. " +
          "Run: docker compose exec -T db psql -X -U postgres -d dacn_db " +
          "-v ON_ERROR_STOP=1 < database/seed/02_lis_results.sql",
        "SEED_ABSENT",
      );
    }

    const total = Number(rows[0].total);
    if (total !== EXPECTED_RESULT_COUNT) {
      throw new FixtureError(
        `Expected exactly ${EXPECTED_RESULT_COUNT} eligible results, found ${total}. ` +
          `Seed tag: ${SEED_TAG}. ` +
          "Ensure the full MIMIC dataset is present and no rows have been removed.",
        "COUNT_MISMATCH",
      );
    }

    // Kiểm tra tính duy nhất (result_id là primary key nên không thể trùng,
    // nhưng xác nhận thêm tại lớp ứng dụng để đáp ứng A01).
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.result_id)) {
        throw new FixtureError(
          `Duplicate result_id detected: ${row.result_id}. ` +
            "This should not occur; please check database integrity.",
          "DUPLICATE_IDS",
        );
      }
      seen.add(row.result_id);
    }

    // Trả tất cả hoặc giới hạn theo `limit` (chỉ để preview/dry-run).
    const results: EligibleResult[] = rows.map((row) => ({
      resultId: row.result_id,
      patientId: row.patient_id,
      testCode: row.test_code,
    }));

    return limit !== undefined ? results.slice(0, limit) : results;
  } catch (error) {
    if (error instanceof FixtureError) throw error;
    throw new FixtureError(
      `Database error while discovering eligible results: ${
        error instanceof Error ? error.message : String(error)
      }`,
      "DATABASE_ERROR",
    );
  } finally {
    await client.end().catch(() => {
      /* Bỏ qua lỗi đóng kết nối */
    });
  }
}

/**
 * Tạo danh sách kết quả tổng hợp để dùng trong unit test (không cần database).
 *
 * Trả chính xác N kết quả với result_id theo thứ tự tất định.
 * Không được dùng trong Publish thực tế.
 */
export function createSyntheticFixtures(count: number): EligibleResult[] {
  if (count < 0 || !Number.isInteger(count)) {
    throw new RangeError("count must be a non-negative integer");
  }
  return Array.from({ length: count }, (_, i) => ({
    resultId: `MIMIC-LAB-SYNTHETIC-${String(i + 1).padStart(5, "0")}`,
    patientId: `MIMIC-P-SYNTHETIC-${String(Math.floor(i / 10) + 1).padStart(5, "0")}`,
    testCode: ["50802", "50912", "50971", "51222", "51492"][i % 5],
  }));
}

/**
 * Tóm tắt dry-run: thống kê kết quả đủ điều kiện mà không lộ dữ liệu lâm sàng.
 *
 * Không bao giờ log patient_id hoặc giá trị lâm sàng ra output.
 */
export interface FixtureSummary {
  seedTag: string;
  totalEligible: number;
  willProcess: number;
  testCodeDistribution: Record<string, number>;
}

export function summarizeFixtures(
  results: readonly EligibleResult[],
  expectedTotal: number = EXPECTED_RESULT_COUNT,
): FixtureSummary {
  const dist: Record<string, number> = {};
  for (const r of results) {
    dist[r.testCode] = (dist[r.testCode] ?? 0) + 1;
  }
  return {
    seedTag: SEED_TAG,
    totalEligible: expectedTotal,
    willProcess: results.length,
    testCodeDistribution: dist,
  };
}
