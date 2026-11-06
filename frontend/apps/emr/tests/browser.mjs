import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { openHttpBrowser, until } from './helpers/browser.mjs'
import { patient, result, uuid, patientKey, otherKey, patientId, patientSystem, resultSystem } from './fixtures.mjs'
const live=process.argv.includes('--real'), mode=process.argv.includes('--dev')?'development':'preview'
const parent=path.resolve(process.env.EMR_EVIDENCE_DIR||'tests/evidence/2026-11-05/browser');mkdirSync(parent,{recursive:true})
const evidence=mkdtempSync(path.join(parent,(live?'real-':'mock-')+mode+'-'));console.log('Evidence: '+evidence)
const report={startedAt:new Date().toISOString(),source:live?'Actual EMR API/proxy, GET only':'Chrome HTTP simulation, synthetic only',mode,cases:[],completed:false}
const patients=[patient(),patient(otherKey,'Other/AbC'),patient(uuid(3),'MIMIC-P-00003')]
let rows=Array.from({length:21},(_,i)=>result(i+1,{quantity:i===0?'0':i===1?'-2.50':'3.400000000000000000001'}))
let patientFault=null,labFault=null,browser
function simulated(req){
 const u=new URL(req.url);assert.equal(req.method,'GET')
 if(u.pathname.endsWith('/patients')){
  if(patientFault)return patientFault
  const p=u.searchParams.has('patient_key')?patients.find(p=>p.patient_key===u.searchParams.get('patient_key')):patients.find(p=>p.identifiers.some(l=>l.identifier_system===u.searchParams.get('identifier_system')&&l.identifier_value===u.searchParams.get('identifier_value')))
  return p?{json:{patient:p}}:{status:404,json:{error:{code:'NOT_FOUND',message:'Patient not found'}}}
 }
 assert.ok(u.pathname.endsWith('/lab-results'));if(labFault)return labFault
 if(u.searchParams.has('external_system')){assert.deepEqual([...u.searchParams.keys()].sort(),['external_id','external_system']);return {json:{items:rows.filter(r=>r.external_system===u.searchParams.get('external_system')&&r.external_id===u.searchParams.get('external_id'))}}}
 const offset=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit'))
 return {json:{items:rows.filter(r=>r.patient_key===u.searchParams.get('patient_key')).slice(offset,offset+limit),limit,offset}}
}
const evaluate=(fn,arg)=>browser.evaluate(fn,arg)
async function state(){return evaluate(()=>({hash:location.hash,kind:document.querySelector('main>section[data-emr]')?.getAttribute('data-emr'),loading:!!document.querySelector('.feedback[role="status"]'),
 patient:document.querySelector('[data-emr="patient-key"]')?.textContent,target:document.querySelector('[data-emr="target-id"]')?.textContent,external:document.querySelector('[data-emr="external-id"]')?.textContent,
 quantity:document.querySelector('[data-emr="quantity"]')?.textContent,detail:document.querySelector('.detail-id')?.textContent,page:document.querySelector('.pagination p')?.textContent,
 rows:[...document.querySelectorAll('.results-card tbody tr')].map(r=>({target:r.dataset.target,source:r.dataset.source,quantity:r.querySelector('[data-emr="list-quantity"]').textContent})),
 body:document.querySelector('main')?.textContent,alerts:[...document.querySelectorAll('[role="alert"]')].map(x=>x.textContent),overflow:document.documentElement.scrollWidth>innerWidth+1}))}
async function settled(){await until(async()=>{const s=await state();return !s.loading&&(s.kind==='search'||s.patient||s.target||s.alerts.length)},'EMR settled')}
async function goto(hash){
 const before=browser.requests.length,previous=(await state()).hash
 if(previous===hash)await browser.command('Page.reload');else await browser.navigate(hash)
 if(hash.startsWith('#/patients/')||hash.startsWith('#/result?')||hash.startsWith('#/search?'))await until(()=>browser.requests.length>before,'target route starts its own GET')
 await until(async()=>{const s=await state();return s.hash===hash&&!s.loading&&(hash.startsWith('#/patients/')?s.kind==='profile'&&(s.patient||s.alerts.length):hash.startsWith('#/result?')?s.kind==='result'&&(s.target||s.alerts.length):s.kind==='search'||s.alerts.length)},'target EMR route');await settled()
}
async function click(text){await evaluate(text=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===text);if(!b||b.disabled)throw new Error('Unavailable: '+text);b.click()},text)}
async function input(id,value){await evaluate(({id,value})=>{const n=document.getElementById(id),proto=n.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(n,value);n.dispatchEvent(new Event(n.tagName==='SELECT'?'change':'input',{bubbles:true}))},{id,value})}
async function action(fn){const n=browser.requests.length;await fn();await until(()=>browser.requests.length>n,'new GET');await settled()}
async function screenshot(name){const {cssContentSize}=await browser.command('Page.getLayoutMetrics');const {data}=await browser.command('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:cssContentSize.width,height:cssContentSize.height,scale:1}});writeFileSync(path.join(evidence,name+'.png'),Buffer.from(data,'base64'))}
async function check(name,fn){const c={name};report.cases.push(c);try{await fn();assert.deepEqual(browser.exceptions,[]);assert.deepEqual(browser.interceptionErrors,[]);c.result='PASS';console.log('PASS: '+name)}catch(error){c.result='FAIL';c.error=String(error.stack??error);c.dom=await state();await screenshot('failure');throw error}}
async function checkPatientLabel(original, expected) {
 const labels=await evaluate(()=>({card:document.querySelector('.patient-card h2')?.textContent,
  profile:document.querySelector('[data-emr="profile"]>.section-heading h2')?.textContent,
  summary:[...document.querySelectorAll('.result-summary .facts>div')].find(n=>n.querySelector('dt').textContent==='Bệnh nhân liên quan')?.querySelector('dd').textContent,
  original:document.querySelector('[data-emr="original-label"]')?.textContent,
  rawVisible:document.querySelector('[data-emr="original-label"]')?.checkVisibility()}))
 assert.equal(labels.card,expected);if(labels.profile!==undefined)assert.equal(labels.profile,'Hồ sơ bệnh nhân – '+expected)
 if(labels.summary!==undefined)assert.equal(labels.summary,expected)
 assert.equal(labels.original,original);assert.equal(labels.rawVisible,false)
 await evaluate(()=>document.querySelector('.patient-card summary').click())
 assert.equal(await evaluate(()=>document.querySelector('[data-emr="original-label"]').checkVisibility()),true)
 await evaluate(()=>document.querySelector('.patient-card summary').click())
}
const resultHash=(id,key)=>'#/result?'+new URLSearchParams({external_system:resultSystem,external_id:id,...(key?{patient_key:key}:{}),value:patientId})
try{
 browser=await openHttpBrowser(live?undefined:simulated,{mode,live});await browser.command('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 let key=patientKey,expectedRows=rows,expectedResult=result(1,{quantity:'0'})
 if(live){const p=await(await fetch('http://127.0.0.1:3103/api/patients?'+new URLSearchParams({identifier_system:patientSystem,identifier_value:patientId}))).json();assert.ok(p.patient);key=p.patient.patient_key;const list=await(await fetch('http://127.0.0.1:3103/api/lab-results?'+new URLSearchParams({patient_key:key,limit:'21',offset:'0'}))).json();expectedRows=list.items;expectedResult=expectedRows.find(r=>r.external_id==='MIMIC-LAB-100145');assert.ok(expectedResult);report.actualPatient=p.patient;report.actualResults=expectedRows}
 await check('Tra cứu ban đầu không GET rộng; gõ chưa tìm không gọi API',async()=>{await goto('#/search');assert.deepEqual(await evaluate(()=>[...document.querySelectorAll('.workflow li')].map(x=>x.textContent.replace(/^[1-3]/,''))),['Tra cứu bệnh nhân','Xem hồ sơ','Xem kết quả xét nghiệm']);const n=browser.requests.length;await input('patient-input','mimic-p-10007928');await delay(100);assert.equal(browser.requests.length,n)})
 await check('Mã nguồn hoa/thường/trim và UUID trả đúng hồ sơ, đúng namespace',async()=>{
  for(const value of [patientId,'mimic-p-10007928','  Mimic-P-10007928  ']){await goto('#/search');await input('patient-input',value);await action(()=>click('Tìm kiếm'));assert.equal((await state()).patient,key);assert.deepEqual(new URL(browser.requests.at(-1).url).searchParams.get('identifier_system'),patientSystem);assert.equal(new URL(browser.requests.at(-1).url).searchParams.get('identifier_value'),patientId)}
  await goto('#/search');await input('patient-mode','key');await input('patient-input',key);await action(()=>click('Tìm kiếm'));assert.equal((await state()).patient,key);assert.equal(new URL(browser.requests.at(-1).url).searchParams.get('patient_key'),key);assert.equal(await evaluate(()=>document.querySelector('.patient-card .primary').textContent),'Xem hồ sơ bệnh nhân');assert.equal(await evaluate(()=>document.querySelector('.patient-card details').open),false);assert.equal(await evaluate(()=>document.querySelector('[data-emr="patient-key"]').checkVisibility()),false)
 })
 await check('Ba trang dùng nhãn Hồ sơ bệnh nhân; nhãn gốc vẫn xem được và API/định danh giữ nguyên',async()=>{
  const savedHash=(await state()).hash
  for(const hash of ['#/search?value='+patientId,'#/patients/'+key,resultHash(expectedResult.external_id,key)]){
   await goto(hash);await checkPatientLabel('Demo patient 10007928','Hồ sơ bệnh nhân 10007928')
   assert.equal((await state()).patient,key)
   await action(()=>click('Làm mới'));await checkPatientLabel('Demo patient 10007928','Hồ sơ bệnh nhân 10007928')
   await action(()=>browser.command('Page.reload'));await checkPatientLabel('Demo patient 10007928','Hồ sơ bệnh nhân 10007928')
  }
  if(live)assert.equal(report.actualPatient.display_label,'Demo patient 10007928')
  else {
   assert.deepEqual(patients[0],patient())
   assert.ok(browser.requests.filter(r=>r.body?.patient?.patient_key===key).every(r=>r.body.patient.display_label==='Demo patient 10007928'))
  }
  await goto(savedHash)
 })
 if(!live)await check('Ba trang giữ nguyên nhãn không khớp, bảo toàn số 0 đầu và không suy diễn nhãn thiếu',async()=>{
  const savedHash=(await state()).hash,saved=patients[0].display_label
  try {
   for(const [label,expected] of [['Nguyễn Văn An','Nguyễn Văn An'],['Demo patient ABC','Demo patient ABC'],['Demo patient 10007928 ','Demo patient 10007928 '],['Demo patient 0000123','Hồ sơ bệnh nhân 0000123'],[null,'Hồ sơ chưa có nhãn hiển thị'],['','Hồ sơ chưa có nhãn hiển thị']]){
    patients[0].display_label=label
    for(const hash of ['#/search?value='+patientId,'#/patients/'+key,resultHash(expectedResult.external_id,key)]){
     await goto(hash)
     if(label)await checkPatientLabel(label,expected)
     else {
      assert.equal(await evaluate(()=>document.querySelector('.patient-card h2').textContent),expected)
      assert.equal(await evaluate(()=>document.querySelector('[data-emr="original-label"]').textContent),label??'—')
     }
     assert.equal((await state()).patient,key);assert.equal(patients[0].display_label,label)
    }
   }
  } finally {patients[0].display_label=saved}
  await goto(savedHash)
 })
 await check('Hồ sơ đúng bệnh nhân: danh sách đúng ID, thứ tự, giá trị, 20 dòng và không total giả',async()=>{
  await action(()=>click('Xem hồ sơ bệnh nhân'));const s=await state();assert.equal(s.patient,key);assert.deepEqual(s.rows,expectedRows.slice(0,20).map(r=>({target:r.target_id,source:r.external_id,quantity:r.quantity})));assert.ok(!s.body.includes('Tổng số'));assert.ok(await evaluate(()=>document.querySelector('main>section>.section-heading h2').textContent.startsWith('Hồ sơ bệnh nhân – ')));assert.equal(await evaluate(()=>document.querySelector('thead th').textContent),'Xét nghiệm');assert.ok(s.body.includes('Các kết quả xét nghiệm đã lưu'));if(expectedRows.length<20){assert.equal(await evaluate(()=>document.querySelectorAll('.pagination button').length),0);assert.ok(s.body.includes('Đang hiển thị '+expectedRows.length+' kết quả'))};await screenshot('profile-desktop')
 })
 await check('Chi tiết đúng cặp nguồn, chuỗi thập phân/microsecond, JSON thu gọn, không VERIFY giả',async()=>{
  await action(()=>evaluate(id=>{const row=[...document.querySelectorAll('tbody tr')].find(r=>r.dataset.source===id);row.querySelector('button').click()},expectedResult.external_id));const s=await state();assert.equal(s.target,expectedResult.target_id);assert.equal(s.patient,key);assert.equal(s.quantity,expectedResult.quantity);assert.ok(s.body.includes(expectedResult.effective_at));assert.ok(s.body.includes(expectedResult.received_at));assert.ok(s.body.includes(expectedResult.stored_at));assert.ok(s.body.includes('Đã lưu tại EMR'));assert.ok(!s.body.includes('Đã VERIFY'));assert.equal(await evaluate(()=>document.querySelector('.technical details').open),false);await screenshot('result-desktop')
 })
 await check('F5/direct URL/Back/Forward giữ đúng kết quả, hồ sơ và tiêu chí tìm kiếm',async()=>{
  const hash=(await state()).hash;await action(()=>browser.command('Page.reload'));assert.equal((await state()).target,expectedResult.target_id);assert.equal((await state()).hash,hash)
  await action(()=>click('Quay lại hồ sơ'));assert.equal((await state()).patient,key);await action(()=>evaluate(()=>history.back()));assert.equal((await state()).target,expectedResult.target_id);await action(()=>evaluate(()=>history.forward()));assert.equal((await state()).patient,key)
  await action(()=>click('Quay lại tra cứu'));await settled();assert.equal(await evaluate(()=>document.getElementById('patient-input').value),key)
  await click('Xóa tìm kiếm');await settled();assert.equal((await state()).patient,undefined);assert.equal((await state()).hash,'#/search')
 })
 await check('Kết quả mở trực tiếp tải hồ sơ riêng; Làm mới GET giữ định danh',async()=>{await goto(resultHash(expectedResult.external_id));assert.equal((await state()).target,expectedResult.target_id);assert.equal((await state()).patient,key);await action(()=>click('Làm mới'));assert.equal((await state()).target,expectedResult.target_id)})
 await check('Thông tin kỹ thuật thu gọn vẫn xem/sao chép đầy đủ; thời gian gốc và FHIR nguyên vẹn',async()=>{
  await goto(resultHash(expectedResult.external_id,key))
  assert.equal(await evaluate(()=>document.querySelector('.technical details').open),false)
  assert.equal(await evaluate(()=>document.querySelector('[data-emr="target-id"]').checkVisibility()),false)
  const timestamps=await evaluate(()=>[...document.querySelectorAll('.recorded-times time')].map(n=>({value:n.getAttribute('datetime'),text:n.textContent})))
  assert.deepEqual(timestamps.map(x=>x.value),[expectedResult.effective_at,expectedResult.received_at,expectedResult.stored_at]);assert.ok(timestamps[0].text.includes('2129'))
  await evaluate(()=>document.querySelector('.technical summary').click())
  assert.ok(await evaluate(()=>document.querySelector('[data-emr="target-id"]').checkVisibility()))
  const technical=await evaluate(()=>{const n=document.querySelector('[data-emr="target-id"]');const range=document.createRange();range.selectNodeContents(n);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);return {selected:selection.toString(),fhir:JSON.parse(document.querySelector('.technical pre').textContent)}})
  assert.equal(technical.selected,expectedResult.target_id);assert.deepEqual(technical.fhir,expectedResult.fhir_json)
  assert.ok((await state()).body.includes('Mã bản ghi kết quả tại EMR'));assert.ok((await state()).body.includes('Hệ thống định danh nguồn'))
  await evaluate(()=>document.querySelector('.technical summary').click());assert.equal(await evaluate(()=>document.querySelector('.technical details').open),false)
 })
 await check('Tra cứu nhanh là lựa chọn riêng: mở mã LIS trực tiếp rồi quay lại tra cứu',async()=>{
  await goto('#/search');assert.equal(await evaluate(()=>document.querySelector('.quick-lookup details').open),false)
  assert.ok((await state()).body.includes('Khi đã biết mã kết quả LIS'))
  await evaluate(()=>document.querySelector('.quick-lookup summary').click());await input('result-input','  '+expectedResult.external_id.toLowerCase()+'  ');await action(()=>click('Mở kết quả'))
  assert.equal((await state()).target,expectedResult.target_id);assert.equal(new URL((await state()).hash.slice(1),'http://localhost').searchParams.has('patient_key'),false)
  await click('Quay lại tra cứu');await settled();assert.equal((await state()).kind,'search')
 })
 if(!live){
  await check('Danh sách ít kết quả chỉ ghi số dòng đang hiển thị, không gợi ý còn trang',async()=>{
   const saved=rows;rows=rows.slice(0,3);await goto('#/patients/'+key);assert.equal((await state()).rows.length,3);assert.equal(await evaluate(()=>document.querySelectorAll('.pagination button').length),0);assert.ok((await state()).body.includes('Đang hiển thị 3 kết quả'));rows=saved
  })
  await check('Phân trang 20/21, offset, F5 chi tiết và quay lại đúng trang 2',async()=>{
   await goto('#/patients/'+key+'?value='+patientId);assert.equal((await state()).rows.length,20);await action(()=>click('Trang sau'));assert.equal((await state()).rows.length,1);assert.equal(new URL(browser.requests.at(-1).url).searchParams.get('offset'),'20');const last=(await state()).rows[0];await action(()=>click('Xem chi tiết'));assert.equal((await state()).target,last.target);await action(()=>browser.command('Page.reload'));await action(()=>click('Quay lại hồ sơ'));assert.equal((await state()).page,'Trang 2');assert.equal((await state()).rows[0].target,last.target);await action(()=>click('Trang trước'));assert.equal((await state()).rows.length,20)
  })
  await check('Hồ sơ tồn tại nhưng rỗng khác với bệnh nhân không tồn tại',async()=>{
   await goto('#/patients/'+uuid(3));assert.equal((await state()).patient,uuid(3));assert.ok((await state()).body.includes('Hồ sơ bệnh nhân tồn tại'))
   await goto('#/patients/'+uuid(99));assert.ok((await state()).alerts.join(' ').includes('Không tìm thấy hồ sơ bệnh nhân'));assert.equal((await state()).patient,undefined)
  })
  await check('UUID sai và URL query lặp/thiếu không phát GET',async()=>{
   await goto('#/search');await input('patient-mode','key');await input('patient-input','bad');const n=browser.requests.length;await click('Tìm kiếm');assert.equal(browser.requests.length,n)
   await browser.navigate('#/result?external_id=x');await until(async()=>(await state()).alerts.join(' ').includes('URL'),'invalid URL');assert.equal(browser.requests.length,n)
  })
  for(const quantity of ['0','-2.50','12345678901234567890.123456789012345678901'])await check('Bảo toàn giá trị '+quantity+' và cận null/zero',async()=>{
   const saved=rows[0];rows[0]={...saved,quantity,low:null,high:'0'};await goto(resultHash(saved.external_id,key));assert.equal((await state()).quantity,quantity);assert.ok((await state()).body.includes('Không có'));rows[0]=saved
  })
  await check('Định danh đặc biệt giữ nguyên, không trộn dấu / % Unicode hoặc khoảng trắng',async()=>{
   const saved=rows[0];for(const id of ['.','..','%2E',' Kết quả/🧪+%?# ']){rows[0]={...saved,external_id:id,fhir_json:{...saved.fhir_json,identifier:[{system:resultSystem,value:id}]}};await goto(resultHash(id,key));assert.equal((await state()).external,id);assert.equal((await state()).target,saved.target_id)}rows[0]=saved
  })
  await check('Không tìm thấy kết quả và nhiều bản ghi cùng cặp nguồn không chọn phần tử đầu',async()=>{
   await goto(resultHash('MIMIC-LAB-999999999999999'));assert.ok((await state()).alerts.join(' ').includes('Không tìm thấy kết quả'))
   labFault={json:{items:[rows[0],rows[0]]}};await goto(resultHash(rows[0].external_id,key));assert.ok((await state()).alerts.join(' ').includes('nhiều kết quả'));assert.equal((await state()).target,undefined);labFault=null
  })
  await check('Patient key hoặc FHIR subject lệch không gán kết quả vào hồ sơ',async()=>{
   await goto(resultHash(rows[0].external_id,otherKey));assert.ok((await state()).alerts.join(' ').includes('không thuộc'));assert.equal((await state()).target,undefined)
   const saved=rows[0];rows[0]={...saved,fhir_json:{...saved.fhir_json,subject:{identifier:{system:patientSystem,value:'WRONG'}}}};await goto(resultHash(saved.external_id,key));assert.ok((await state()).alerts.join(' ').includes('không khớp'));rows[0]=saved
  })
  for(const [name,fault,message] of [['400',{status:400,json:{error:{code:'VALIDATION_ERROR'}}},'HTTP 400'],['404 route',{status:404,json:{error:{message:'API route not found'}}},'Cần cập nhật service EMR'],['503',{status:503,json:{error:{code:'DEPENDENCY_UNAVAILABLE'}}},'HTTP 503'],['network',{networkError:true},'Không kết nối'],['JSON',{html:'<html>bad</html>'},'JSON không hợp lệ'],['schema',{json:{items:[{}]}},'không hợp lệ']])await check('Lỗi '+name+' và phục hồi GET cùng kết quả',async()=>{
   labFault=fault;await goto(resultHash(rows[0].external_id,key));assert.ok((await state()).alerts.join(' ').includes(message));assert.equal((await state()).target,undefined);labFault=null;await action(()=>click('Thử tải lại'));assert.equal((await state()).target,rows[0].target_id)
  })
  await check('API bệnh nhân chưa triển khai khác hồ sơ thiếu; phục hồi không đổi query',async()=>{
   patientFault={status:404,json:{error:{message:'API route not found'}}};await goto('#/search?value='+patientId);assert.ok((await state()).alerts.join(' ').includes('Cần cập nhật service EMR'));patientFault=null;await action(()=>click('Thử tải lại'));assert.equal((await state()).patient,key)
  })
  await check('Danh sách lỗi 503 phục hồi giữ trang 2 và không hiển thị dữ liệu cũ',async()=>{
   await goto('#/patients/'+key+'?page=2&value='+patientId);labFault={status:503,json:{error:{}}};await action(()=>click('Làm mới'));assert.equal((await state()).rows.length,0);assert.ok((await state()).alerts.length);labFault=null;await action(()=>click('Thử tải lại'));assert.equal((await state()).page,'Trang 2');assert.equal((await state()).rows.length,1)
  })
  await check('Abort và phản hồi hồ sơ A đến muộn không ghi đè hồ sơ B',async()=>{
   await goto('#/search');await evaluate(key=>{window.beforeHold=window.fetch;window.fetch=async(url,options)=>{const response=await window.beforeHold(url,{...options,signal:undefined});if(String(url).includes('patient_key='+key)&&String(url).includes('/patients?')){window.heldSignal=options.signal;await new Promise(resolve=>{window.releaseHold=resolve})}return response};location.hash='#/patients/'+key},otherKey)
   await until(()=>evaluate(()=>!!window.releaseHold),'held response');await evaluate(key=>{location.hash='#/patients/'+key},key);await until(async()=>(await state()).patient===key&&!(await state()).loading,'new profile');assert.equal(await evaluate(()=>window.heldSignal.aborted),true);await evaluate(()=>window.releaseHold());await delay(150);assert.equal((await state()).patient,key);await evaluate(()=>{window.fetch=window.beforeHold})
  })
 }
 await check('Responsive desktop/mobile: bảng cuộn riêng, giá trị đầy đủ và JSON thu gọn',async()=>{
  await goto('#/patients/'+key);await browser.command('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});assert.equal((await state()).overflow,false);await screenshot('profile-mobile');await goto(resultHash(expectedResult.external_id,key));assert.equal((await state()).overflow,false);assert.equal((await state()).quantity,expectedResult.quantity);await screenshot('result-mobile')
 })
 assert.ok(browser.requests.every(r=>r.method==='GET'));report.completed=true
}finally{if(browser){report.requests=browser.requests;report.exceptions=browser.exceptions;report.interceptionErrors=browser.interceptionErrors;await browser.close()}report.finishedAt=new Date().toISOString();writeFileSync(path.join(evidence,'verification.json'),JSON.stringify(report,null,2)+'\n')}
