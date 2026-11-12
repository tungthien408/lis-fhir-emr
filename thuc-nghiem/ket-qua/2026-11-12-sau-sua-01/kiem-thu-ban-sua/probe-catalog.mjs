import { pathToFileURL } from 'node:url';
import path from 'node:path';
const base = path.resolve(process.argv[2]);
const load = name => import(pathToFileURL(path.join(base, name)).href);
const {validateExchangeEnvelope} = await load('src/middleware/service.ts');
const {validateObservation} = await load('src/emr/service.ts');
const {validEnvelope, rehash} = await load('tests/middleware/service-fixtures.ts');
const {validObservation} = await load('tests/emr/service-fixtures.ts');
const results = [];
for (const [code,unit] of [['99999','mg/dL'],['50912','kg']]) {
 const input=validEnvelope(); input.source_snapshot.test_code=code; input.source_snapshot.unit=unit; rehash(input);
 const result=validateExchangeEnvelope(input);
 results.push({boundary:'middleware',test_code:code,unit,kind:result.kind,error:result.error??null});
}
for (const mode of ['unknown-code','all-kg','kg-without-range']) {
 const input=validObservation();input.code.coding[0].code=mode==='unknown-code'?'99999':'50912';input.valueQuantity.unit=mode==='unknown-code'?'mg/dL':'kg';
 for(const range of input.referenceRange??[])for(const k of ['low','high'])if(range[k])range[k].unit=input.valueQuantity.unit;
 if(mode==='kg-without-range')delete input.referenceRange;
 const result=validateObservation(input);
 results.push({boundary:'emr',mode,kind:result.kind,error:result.error??null});
}
console.log(JSON.stringify(results,null,2));
