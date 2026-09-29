import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { applySaleInventoryAccounting } from '../app/lib/inventory-accounting.ts';
import { applyWorkerConsumption, editWorkerConsumption, deleteWorkerConsumption } from '../app/lib/worker-consumptions.ts';
import { calculateDailyReport } from '../app/lib/daily-report.ts';

const now='2026-09-27T08:00:00.000Z';
const date='2026-09-27';
const actor={id:'worker',name:'Xodim'};
const seed=()=>({inventory:[
 {id:'flour',name:'UN',unit:'g',stock:1000,unitCost:2},
 {id:'sauce',name:'SOUS',unit:'g',stock:-500,unitCost:10,expenseOnly:true,expenseOnlyHistory:[{enabled:true,at:'2026-09-01T00:00:00Z',by:'owner'}]},
],recipes:[{id:'meal',name:'Lavash',ingredients:[{inventoryId:'flour',quantity:100,unitCost:2},{inventoryId:'sauce',quantity:20,unitCost:1,lineCost:20}],extraCosts:[{amount:50}]}],workerConsumptions:[],stockMovements:[],monthlyCloses:[],financialEntries:[{id:'already-expensed',type:'expense',category:'Sabzavot va sous',date,amount:5000,nonCash:true,affectsProfit:true}],sales:[],costRules:{taxPct:0,cardCommissionPct:0,deliveryCommissionPct:0}});
const input={operationId:'meal-operation-001',kind:'meal',recipeId:'meal',quantity:1,date};

test('restored expense-only sale preserves stored price, zero prices and historical excluded cost',()=>{
 for(const price of [0,10]){
  const s=seed(); const sale={id:'saved-sale',date,totalCost:1000,stockUsage:[{inventoryId:'sauce',quantity:10,unitCostAtSale:price,totalCostAtSale:10*price,expenseOnlyAtSale:true,deductedQuantity:0}],expenseOnlyCost:price*10};
  s.inventory[1].unitCost=20; s.inventory[1].expenseOnly=false; s.inventory[1].expenseOnlyHistory=[{enabled:false,at:'2026-09-01T00:00:00Z',by:'owner'}];
  const result=applySaleInventoryAccounting(s,{...s,sales:[sale]},now);
  assert.deepEqual(result.sales[0].stockUsage,sale.stockUsage);
  assert.equal(result.sales[0].expenseOnlyCost,sale.expenseOnlyCost);
  assert.equal(result.inventory[1].stock,-500);
 }
});

test('new sale still prices expense-only ingredients at current purchase cost before saving snapshot',()=>{
 const s=seed(),sale={id:'new-sale',date,totalCost:450,stockUsage:[{inventoryId:'sauce',quantity:20,unitCostAtSale:1,totalCostAtSale:20}]};
 const result=applySaleInventoryAccounting(s,{...s,sales:[sale]},now);
 assert.equal(result.sales[0].expenseOnlyCost,200);
 assert.equal(result.sales[0].stockUsage[0].unitCostAtSale,10);
});

test('new meal records theoretical sauce use without negative stock or charging its purchase twice',()=>{
 const original=seed(),s=structuredClone(original);
 const {state:next,result}=applyWorkerConsumption(s,input,actor,now);
 assert.deepEqual(s,original);
 assert.equal(next.inventory[0].stock,900); assert.equal(next.inventory[1].stock,-500);
 assert.equal(result.entry.totalCost,450);assert.equal(result.entry.expenseOnlyCost,200);
 assert.equal(result.entry.stockShortages,undefined);
 const sauce=next.stockMovements.find(m=>m.inventoryId==='sauce');
 assert.equal(sauce.quantity,0);assert.equal(sauce.theoreticalQuantity,20);
 const report=calculateDailyReport(next,date);
 assert.equal(report.inventoryOnlyCost,250);assert.equal(report.totalExpenses,5250);
 assert.equal(report.netProfit,-5250);
 assert.equal(applyWorkerConsumption(next,input,actor,now).result.alreadySaved,true);
 assert.deepEqual(deleteWorkerConsumption(next,result.entry.id,actor).state.inventory,original.inventory);
 // Even a legacy repair that removed linked movements must use saved physical usage.
 const withoutMovements={...next,stockMovements:[]};
 assert.deepEqual(deleteWorkerConsumption(withoutMovements,result.entry.id,actor).state.inventory,original.inventory);
});

test('earlier consumption and saved legacy records keep original physical and financial treatment',()=>{
 const s=seed();
 const early=applyWorkerConsumption(s,{...input,date:'2026-08-30'},actor,now);
 assert.equal(early.state.inventory[1].stock,-520);assert.equal(early.result.entry.expenseOnlyCost,0);
 const legacy={id:'worker-consumption:legacy-operation',operationId:'legacy-operation',date,kind:'meal',recipeId:'meal',quantity:1,workerId:actor.id,workerName:actor.name,createdAt:now,totalCost:270,costSnapshotVersion:2,ingredientUsage:[{inventoryId:'flour',quantity:100,totalCostAtOutflow:200},{inventoryId:'sauce',quantity:20,totalCostAtOutflow:20}],movementIds:[]};
 const before={...s,workerConsumptions:[legacy]};
 assert.equal(calculateDailyReport(before,date).inventoryOnlyCost,270);
 const edited=editWorkerConsumption(before,{...input,recordId:legacy.id},actor,now);
 assert.equal(edited.result.entry.expenseOnlyCost,0);
 assert.equal(edited.state.inventory[1].stock,-500);
 assert.deepEqual(before.workerConsumptions[0],legacy);
});

test('new outflows retain all existing history rather than truncating at 5000 records',()=>{
 const s=seed();s.workerConsumptions=Array.from({length:5001},(_,i)=>({id:`history-${i}`,date:'2026-08-01',totalCost:i,kind:'waste'}));
 const next=applyWorkerConsumption(s,input,actor,now).state;
 assert.equal(next.workerConsumptions.length,5002);
 assert.deepEqual(next.workerConsumptions.slice(1),s.workerConsumptions);
});

test('built API initialization without legacy migration markers preserves stored business data byte for byte',async()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec('CREATE TABLE app_state (id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL)');
 const legacy={...seed(),suppliers:[{id:'n',name:'Nodir',balance:198000}],transactions:[{id:'historic-purchase',supplierId:'n',type:'purchase',date,amount:400000}],workShifts:[{id:'keep-old-shift',date:'2026-08-01',checkIn:'2026-08-01T00:00:00Z'}],stockMovements:[{id:'keep-old-receipt',inventoryId:'flour',type:'receipt',date:'2026-08-01',quantity:1000}],auditLog:[{id:'keep-audit'}]};
 const raw=JSON.stringify(legacy);
 sql.prepare('INSERT INTO app_state VALUES (?,?,?)').run('main',raw,'unchanged-revision');
 sql.prepare('INSERT INTO app_state VALUES (?,?,?)').run('branch-other',raw,'other-revision');
 const db={prepare(query){let values=[];return {bind(...v){values=v;return this;},async first(column){const r=sql.prepare(query).get(...values);return column?r?.[column]??null:r??null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};},async batch(q){const out=[];for(const statement of q)out.push(await statement.run());return out;},async exec(s){sql.exec(s);return {count:1,duration:0};}};
 try {
  const {default:worker}=await import('../dist/server/index.js');
  const response=await worker.fetch(new Request('http://localhost/api/state?revision=1',{headers:{'oai-authenticated-user-email':'owner@preservation-local-test.invalid'}}),{DB:db,ASSETS:{fetch:async()=>new Response('',{status:404})}},{waitUntil(){},passThroughOnException(){}});
  assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual(await response.json(),{updatedAt:'unchanged-revision'});
  for(const id of ['main','branch-other']) assert.equal(sql.prepare('SELECT payload FROM app_state WHERE id=?').get(id).payload,raw);
  assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM halo_state_backups').get().count,0);
  assert.ok(sql.prepare('SELECT id FROM halo_migrations WHERE id=?').get('reset-main-inventory-count-2026-08-20-v1'));
 } finally {sql.close();delete globalThis.__HALO_CONTROL_DB__;}
});
