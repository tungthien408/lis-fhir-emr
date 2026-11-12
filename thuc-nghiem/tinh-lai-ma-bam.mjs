// Đọc 1 gói tin LIS→middleware (JSON) từ stdin, tính lại source_hash theo đúng cách của hệ thống, in ra gói tin mới.
// Dùng để tạo các gói tin "hợp lệ về mã băm nhưng sai nội dung" khi thử kịch bản dữ liệu sai.
// Chạy từ thư mục backend: node --import tsx ../thuc-nghiem/tinh-lai-ma-bam.mjs < goi-tin.json
const { hashCanonicalJson } = await import(process.cwd() + '/src/lis/canonical-json.ts');
let text = ''; for await (const chunk of process.stdin) text += chunk;
const envelope = JSON.parse(text);
envelope.source_hash = hashCanonicalJson(envelope.source_snapshot);
process.stdout.write(JSON.stringify(envelope));
