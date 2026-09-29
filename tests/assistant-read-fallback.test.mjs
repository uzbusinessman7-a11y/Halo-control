import test from 'node:test';
import assert from 'node:assert/strict';
import { localReadIntent } from '../app/lib/assistant-read-intent.ts';
import { understandCommand } from '../app/lib/assistant-ai.ts';
import { assistantReport } from '../app/lib/assistant-engine.ts';
import { assistantServiceError } from '../app/lib/assistant-service-error.ts';
const state={suppliers:[{id:'n',name:'Nodir aka',balance:948000}],inventory:[{id:'s',name:'Sous',unit:'g'}],transactions:[{id:'u',type:'purchase',supplierId:'n',date:'2026-09-23',intakeLines:[{name:'Sous',quantity:2,unit:'kg',amount:60000}]}],stockMovements:[{id:'a',referenceId:'u',supplierId:'n',inventoryId:'s',type:'receipt',date:'2026-09-23',quantity:2000,unitCost:30},{id:'b',supplierId:'n',inventoryId:'s',type:'receipt',date:'2026-09-01',quantity:30000,unitCost:1},{id:'c',supplierId:'other',inventoryId:'s',type:'receipt',date:'2026-09-01',quantity:9999,unitCost:1}]};
test('exact screenshot request works with AI disconnected, returning old and new receipts once',async()=>{
 globalThis.__HALO_ASSISTANT_AI__=undefined;
 const original=JSON.stringify(state);
 const intent=await understandCommand('Nodir akadan olingan mahsulotlar ro’yxatini ber',state);
 assert.equal(intent.kind,'supplier_products');
 const result=assistantReport(state,intent);
 assert.match(result,/60000|60,000/);assert.match(result,/30000 g/);assert.match(result,/Jami 2 ta/);assert.doesNotMatch(result,/9999/);assert.equal(JSON.stringify(state),original);
});
test('natural read aliases route, ambiguous names and writes do not silently choose',()=>{
 for(const text of ['Nodirdan nima olingan?','Nodir aka mahsulotlar royxatini ber','Nodir akadan kelgan maxsulotlar royhatini ber'])assert.equal(localReadIntent(text,state,'2026-09-24')?.kind,'supplier_products');
 assert.equal(localReadIntent('Nodir aka qarzi qancha?',state,'2026-09-24')?.kind,'debts');
 for(const text of ['Nodir akadan 2 kg sous oldim','Nodir aka mahsulotlarini ochir','Nodir akadan kecha nima olingan?','Nodir aka mahsulotlar ro‘yxatini PDF ber'])assert.equal(localReadIntent(text,state,'2026-09-24'),null);
 const ambiguous={suppliers:[{id:'n',name:'Nodir aka'},{id:'n2',name:'Nodir'}]};
 assert.equal(localReadIntent('Nodirdan nima olingan?',ambiguous,'2026-09-24').kind,'clarify');
});
test('service failure distinguishes credit, key, rate and request configuration without raw errors',()=>{
 assert.match(assistantServiceError(429,'insufficient_quota'),/balansi/);
 assert.match(assistantServiceError(429,'credit_balance_exhausted'),/mablag‘ qolmagan/);
 assert.doesNotMatch(assistantServiceError(429,'credit_balance_exhausted'),/vaqtincha limit/);
 assert.match(assistantServiceError(401,'invalid_api_key'),/kaliti/);
 assert.match(assistantServiceError(429,'rate_limit_exceeded'),/vaqtincha limit/);
 assert.match(assistantServiceError(400,''),/sizning yozishingizdagi xato emas/);
});
