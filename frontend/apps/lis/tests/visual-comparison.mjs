// Assemble original PNGs and actual Chrome captures without modifying either image.
// Usage: node apps/lis/tests/visual-comparison.mjs <extracted-handoff-directory>
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

assert.ok(process.argv[2], 'Pass the temporary extracted handoff directory')
const references = path.join(path.resolve(process.argv[2]), 'stitch_reference/stitch_flow_console_dashboard')
const output = path.join(import.meta.dirname, 'evidence/stitch-redesign')
mkdirSync(output, { recursive: true })
const states = [
  ['A', 'ready', 'Sẵn sàng', 'flow_console_trao_i_k_t_qu_x_t_nghi_m', 'Giữ ba cột, danh sách LIS, năm trạm và bảng bằng chứng 9 hàng. Chưa có FHIR hoặc liên kết EMR thì hiển thị chưa xác minh; không chép dữ liệu minh họa.'],
  ['B', 'processing', 'Đang xử lý', 'flow_console_ang_x_l_truy_n_d_li_u', 'Hai trạm đầu hoàn tất, trạm FHIR đang xử lý theo phản hồi test; nút gửi bị khóa. Không nhân đôi thẻ bệnh nhân như ảnh B. Nhật ký phản ánh số sự kiện API thực sự trả về.'],
  ['C', 'delivered', 'DELIVERED', 'flow_console_truy_n_d_li_u_th_nh_c_ng', 'Banner xanh, năm trạm hoàn tất, kết quả EMR và bảng 9 trường khớp. Hash được tính thật từ payload; giá trị số giữ độ chính xác, không ép định dạng giống dữ liệu mẫu.'],
  ['D', 'rejected', 'REJECTED', 'flow_console_emr_t_ch_i_422_patient_not_linked', 'Banner đỏ, lỗi tại trạm lưu EMR, đối soát không thực hiện, thẻ lỗi EMR và nhật ký. API chuẩn hóa 422 thành REMOTE_VALIDATION_ERROR nên không khẳng định bệnh nhân chưa liên kết.'],
]
const dimensions = file => { const png = readFileSync(file); return `${png.readUInt32BE(16)} × ${png.readUInt32BE(20)}` }
const panels = states.map(([letter, state, label, folder, note], i) => {
  const original = `reference-${letter}.png`, actual = `mock-preview-${state}.png`
  assert.ok(existsSync(path.join(output, actual)), `Capture ${actual} first`)
  copyFileSync(path.join(references, folder, 'screen.png'), path.join(output, original))
  return `<section id="state-${letter}" ${i ? 'hidden' : ''}><h2>${letter} · ${label}</h2><p>${note}</p><div class="pair"><figure><figcaption>Stitch gốc · ${dimensions(path.join(output, original))}</figcaption><img src="${original}" alt="Stitch ${letter}"></figure><figure><figcaption>React / API test · ${dimensions(path.join(output, actual))}</figcaption><img src="${actual}" alt="React ${letter}"></figure></div><details><summary>Chồng ảnh để đối chiếu bố cục (căn cùng mép trên, chiều rộng)</summary><label>Độ đậm React <input type="range" min="0" max="1" step="0.05" value="0.5" oninput="this.closest('details').querySelector('.overlay img:last-child').style.opacity=this.value"></label><div class="overlay"><img src="${original}" alt="Stitch ${letter}"><img src="${actual}" alt="React ${letter}"></div></details></section>`
}).join('\n')
writeFileSync(path.join(output, 'comparison.html'), `<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Đối chiếu Stitch / React</title><style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#f9f9ff;color:#141b2b;font:15px/1.6 system-ui,sans-serif}h1{font-size:24px;margin:0}h2{font-size:20px}p{max-width:1100px}nav{display:flex;gap:10px;position:sticky;top:0;background:#f9f9ff;padding:12px 0;z-index:2}button,summary{cursor:pointer}button{border:1px solid #d8d6eb;border-radius:8px;padding:10px 18px;background:#fff;color:#3525cd}button[aria-pressed=true]{background:#3525cd;color:white}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0;min-width:0}figcaption{padding:10px;background:white;font-weight:600}img{width:100%;height:auto;display:block}details{margin-top:24px}label{display:block;margin:12px 0}.overlay{position:relative;max-width:1536px;overflow:hidden}.overlay img:last-child{position:absolute;inset:0;opacity:.5}a{color:#3525cd}@media(max-width:700px){body{padding:12px}.pair{grid-template-columns:1fr}}
</style><h1>Đối chiếu Google Stitch và React</h1><p>Bốn ảnh React chụp từ bản build bằng Chrome, với HTTP fixtures trong bộ kiểm thử. Đây là kiểm chứng giao diện, không phải bằng chứng bốn giao dịch đã chạy trên backend thật. Các ảnh không bị chỉnh sửa. Phông chữ Inter / JetBrains Mono được đóng gói cục bộ; icon SVG còn khác nét so với Material Symbols.</p><p>Ảnh API thật (GET, không Publish): <a href="real-preview-ready.png">Sẵn sàng</a> · <a href="real-preview-delivered.png">DELIVERED</a>. Thời gian, định danh và độ dài nhật ký có thể khác bản mẫu theo dữ liệu thực.</p><nav>${states.map(([letter,,label],i) => `<button aria-pressed="${i === 0}" onclick="document.querySelectorAll('section').forEach(s=>s.hidden=s.id!=='state-${letter}');document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-pressed',String(b===this)))">${letter} · ${label}</button>`).join('')}</nav>${panels}</html>`, 'utf8')
console.log(path.join(output, 'comparison.html'))
