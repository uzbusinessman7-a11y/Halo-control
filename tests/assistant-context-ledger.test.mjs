import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationContext } from '../app/lib/assistant-context.ts';
import { supplierLedger } from '../app/lib/supplier-ledger.ts';
import { assistantReport } from '../app/lib/assistant-engine.ts';
import { validateDailyCloseInput } from '../app/lib/daily-close.ts';
test('conversation history isolates owners, branches, generations and old or unfinished jobs',()=>{
 const scope={actor:'owner',branch:'main',generation:'a',now:2e6,currentId:'now'};
 const job={id:'1',actor:'owner',branch_id:'main',generation:'a',created_at:1999000,input:'2kg un oldim',response:'Qancha to‘landi?',status:'error'};
 const result=conversationContext([job,{...job,id:'2',created_at:1999900,input:'8000',response:'Qaysi hisob?',status:'error'},...['actor','branch_id','generation'].map(k=>({...job,[k]:'other'})),{...job,id:'now'},{...job,created_at:1},{...job,status:'processing'}],scope);
 assert.equal(result.length,2);assert.equal(result[0].assistant,'Qancha to‘landi?');assert.equal(result[1].user,'8000');
});
test('supplier ledger separates payment from adjustment and reaches corrected outstanding balance',()=>{
 const supplier={id:'n',balance:948000,openingBalance:1106500,balanceEdits:[{id:'e',at:'2026-09-24T01:00:00Z',openingBalance:1106500,previousOpeningBalance:948000,reason:'Qoldiq tekshirildi'}]};
 const tx=[{id:'p',supplierId:'n',type:'payment',amount:158500,date:'2026-09-23'}];
 const ledger=supplierLedger(supplier,tx);
 assert.equal(ledger.opening,948000);assert.equal(ledger.entries[0].balance,789500);assert.equal(ledger.entries[1].kind,'adjustment');assert.equal(ledger.balance,948000);assert.equal(ledger.difference,0);
 assert.match(assistantReport({suppliers:[{...supplier,name:'Nodir aka'}],transactions:tx},{kind:'ledger',query:'Nodir'}),/948,000/);
});
test('offsetting bank and cash discrepancies still require explanation',()=>{
 const input={date:'2026-09-24',today:'2026-09-24',accounts:[{id:'cash'},{id:'bank'}],expectedByAccount:{cash:1000,bank:1000},actualByAccount:{cash:900,bank:1100}};
 assert.equal(validateDailyCloseInput(input).ok,false);
 assert.equal(validateDailyCloseInput({...input,note:'Hisoblar orasida o‘tkazma'}).ok,true);
});
test('reports reject inverted or excessive ranges',()=>{
 assert.throws(()=>assistantReport({},{kind:'report',date:'2026-09-24',dateTo:'2026-09-23'}),/366/);
 assert.throws(()=>assistantReport({},{kind:'report',date:'2020-01-01',dateTo:'2026-09-23'}),/366/);
});
