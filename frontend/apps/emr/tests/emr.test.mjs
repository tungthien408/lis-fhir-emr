import { normalizeInput } from '../src/state/routes.ts'

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPatient, getResults, getResult, validatePatient, validateResult, assertAssociation } from '../src/api/emr.ts'
import { patient, result, uuid, patientKey, otherKey, patientId, patientSystem, resultSystem } from './fixtures.mjs'
const search = { mode: 'source', value: patientId }
test('Chỉ chuẩn hóa mã MIMIC hợp lệ; giữ mã tùy ý và số 0 đầu', () => {
  for (const [input,kind,expected] of [[' mimic-p-001 ', 'patient', 'MIMIC-P-001'], ['mImIc-LaB-100145', 'result', 'MIMIC-LAB-100145'], [' Local/AbC ', 'patient', 'Local/AbC'], ['mimic-p-abc', 'patient', 'mimic-p-abc']]) assert.equal(normalizeInput(input,kind), expected)
})
for (const mode of ['source','key']) test('GET bệnh nhân đúng namespace/mode, no-store và identity: ' + mode, async t => {
  const p = patient(), signal = new AbortController().signal
  t.mock.method(globalThis,'fetch',async (path,options) => {
    const url = new URL(path,'http://localhost'); assert.equal(url.pathname,'/api/emr/patients');assert.equal(options.signal,signal);assert.equal(options.cache,'no-store');assert.equal(options.method,undefined)
    assert.deepEqual(Object.fromEntries(url.searchParams), mode === 'source' ? { identifier_system:patientSystem, identifier_value:patientId } : { patient_key:patientKey }); return Response.json({ patient:p })
  })
  assert.deepEqual(await getPatient({mode,value:mode === 'source' ? ' mimic-p-10007928 ' : patientKey},signal),p)
})
for (const n of [0,20,21]) test('Danh sách '+n+': patient_key chính xác, limit21 offset20, không total giả',async t=>{
  const rows=Array.from({length:n},(_,i)=>result(i+1))
  t.mock.method(globalThis,'fetch',async path=> {assert.deepEqual(Object.fromEntries(new URL(path,'http://localhost').searchParams),{patient_key:patientKey,limit:'21',offset:'20'});return Response.json({items:rows,limit:21,offset:20})})
  assert.deepEqual(await getResults(patient(),2),{items:rows.slice(0,20),hasNext:n===21})
})
test('Chi tiết dùng đúng cặp nguồn không trộn patient/limit; giữ dữ liệu và hồ sơ',async t=>{
  const row=result(), calls=[]
  t.mock.method(globalThis,'fetch',async path=>{const url=new URL(path,'http://localhost');calls.push(url.pathname); if(url.pathname.endsWith('/patients'))return Response.json({patient:patient()}); assert.deepEqual(Object.fromEntries(url.searchParams),{external_system:resultSystem,external_id:row.external_id});return Response.json({items:[row]})})
  assert.deepEqual(await getResult(resultSystem,row.external_id,patientKey),{result:row,patient:patient()});assert.equal(calls.length,2)
})
for(const quantity of ['0','-2.50','12345678901234567890.123456789012345678901','3.4000']) test('Bảo toàn chuỗi thập phân '+quantity,()=>{
  const row=result(1,{quantity,low:null,high:'0'}); assert.equal(validateResult(row).quantity,quantity);assert.equal(validateResult(row).effective_at,'2129-04-05T21:30:00.123456Z');assert.equal(row.high,'0')
})
test('Schema sai, số number, status giả hoặc identity sai không trở thành dữ liệu hợp lệ',()=>{
  for(const patch of [{quantity:3.4},{low:0},{clinical_status:'DELIVERED'},{effective_at:'bad'},{target_id:'bad'},{fhir_json:{}},{external_id:'wrong'}])assert.throws(()=>validateResult({...result(),...patch}))
  assert.throws(()=>validatePatient({patient_key:patientKey}));assert.throws(()=>assertAssociation(result(),patient(otherKey)));assert.throws(()=>assertAssociation(result(),patient(patientKey,'OTHER')))
})
for(const [items,message] of [[[],'Không tìm thấy kết quả'],[[result(),result(2)],'nhiều kết quả']])test('Chi tiết không chọn bản ghi đầu: '+message,async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({items})});await assert.rejects(getResult(resultSystem,result().external_id),e=>e.message.includes(message));assert.equal(calls,1)
})
test('Không trộn bệnh nhân; danh sách và chi tiết fail trước khi hiển thị',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({items:[result(1,{patient_key:otherKey})],limit:21,offset:0}));await assert.rejects(getResults(patient(),1),/không khớp/)
  await assert.rejects(getResult(resultSystem,result().external_id,patientKey),/không thuộc/)
})
for(const [status,message,expected] of [[400,'bad','không hợp lệ'],[404,'Patient not found','Không tìm thấy hồ sơ'],[404,'API route not found','Cần cập nhật service EMR'],[503,'bad','chưa truy cập']])test('HTTP '+status+' '+message,async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({error:{code:'SYNTHETIC',message}},{status}));await assert.rejects(getPatient(search),e=>e.message.includes(expected))
})
test('Mạng/JSON/schema/abort không thành rỗng hoặc kết quả đã lưu',async t=>{
  for(const response of [()=>{throw new TypeError('network')},()=>new Response('<html>bad</html>'),()=>Response.json({patient:{}})]){
    t.mock.method(globalThis,'fetch',async()=>response());await assert.rejects(getPatient(search));t.mock.restoreAll()
  }
  const c=new AbortController();c.abort();t.mock.method(globalThis,'fetch',async(_p,o)=>o.signal.throwIfAborted());await assert.rejects(getPatient(search,c.signal),{name:'AbortError'})
})
