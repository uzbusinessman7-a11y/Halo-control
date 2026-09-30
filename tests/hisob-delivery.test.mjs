import test from 'node:test';
import assert from 'node:assert/strict';
import {applyPosOrder,buildPosTerminalView} from '../app/lib/pos-terminal.ts';
const when='2026-09-25T12:00:00Z',actor={id:'pos-terminal',name:'Ali'};
const seed=()=>({inventory:[{id:'meat',name:'Meat',unit:'g',stock:1000,unitCost:10},{id:'veg',name:'KARAM',unit:'g',stock:0,unitCost:2,expenseOnly:true}],recipes:[{id:'r',name:'Lavash',categoryId:'recipe-other',salePrice:10000,deliveryPrices:{coupang:13900,baemin:14900},ingredients:[{inventoryId:'meat',quantity:100},{inventoryId:'veg',quantity:50}]}],sales:[],stockMovements:[],posOrders:[],monthlyCloses:[],accounts:[{id:'cash',type:'cash'},{id:'bank',type:'bank'},{id:'delivery',type:'delivery'}],costRules:{taxPct:10,cardCommissionPct:1.6,deliveryPlatformRules:{coupang:{combinedPct:16,brokeragePct:0,paymentPct:0,deliveryFeeWon:3400,vatPct:0,couponPct:0,instantDiscountWon:1000,advertisingPct:0},baemin:{combinedPct:0,brokeragePct:0,paymentPct:0,deliveryFeeWon:0,vatPct:0,couponPct:0,instantDiscountWon:0,advertisingPct:0}}}});
const input=()=>({operationId:'hisob-delivery-001',paymentType:'delivery',deliveryPlatform:'coupang',deliveryOrderNumber:'ABC123',expectedTotal:27800,deliveryFeesWon:{brokerage:'2168',delivery:'3400',vat:'557'},items:[{recipeId:'r',quantity:2}]});
test('delivery uses platform price, one order/fee allocation, delivery tax (owner rule), correct stock and retry',()=>{
 const s=seed(),before=structuredClone(s),result=applyPosOrder(s,input(),actor,when),out=result.state;
 assert.deepEqual(s,before);assert.equal(out.sales[0].unitPrice,13900);assert.equal(out.sales[0].totalRevenue,27800);assert.equal(out.sales[0].source,'delivery');assert.equal(out.sales[0].accountId,'delivery');assert.equal(out.sales[0].taxPctAtSale,10);assert.equal(out.sales[0].salesChannel,'delivery');assert.equal(out.sales[0].cardCommissionPctAtSale,0);assert.equal(out.sales[0].deliveryCommissionAmount,8848);assert.equal(out.inventory[0].stock,800);assert.equal(out.inventory[1].stock,0);
 assert.deepEqual(applyPosOrder(out,input(),actor,when).state,out);
 assert.throws(()=>applyPosOrder(out,{...input(),operationId:'hisob-delivery-002'},actor,when),/oldin/);
 assert.equal(applyPosOrder(out,{...input(),deliveryOrderNumber:'OTHER'},actor,when).result.alreadySaved,true);
 assert.equal(buildPosTerminalView(out).orders[0].editable,false);
 const cash=applyPosOrder(s,{operationId:'hisob-cash-001',paymentType:'cash',items:[{recipeId:'r',quantity:2}]},actor,when).state;assert.equal(cash.sales[0].totalRevenue,20000);assert.equal(cash.sales[0].source,'pos');
});
test('missing delivery price, wrong platform and stale total fail; employee fee input is ignored',()=>{
 const s=seed();for(const change of [{deliveryPlatform:'yogiyo'},{deliveryPlatform:'invalid'},{expectedTotal:20000}])assert.throws(()=>applyPosOrder(s,{...input(),...change},actor,when));assert.equal(s.sales.length,0);
 const automatic=applyPosOrder(s,{...input(),deliveryOrderNumber:'',deliveryFeesWon:{vat:-1}},actor,when).state;assert.equal(automatic.sales[0].deliveryCommissionAmount,8848);assert.match(String(automatic.sales[0].deliveryOrderNumber),/^HALO-/);
 const b=applyPosOrder(s,{...input(),deliveryPlatform:'baemin',expectedTotal:29800,deliveryFeesWon:{}},actor,when).state;assert.equal(b.sales[0].totalRevenue,29800);assert.equal(b.sales[0].deliveryCommissionAmount,0);
});
test('all rows share batch and fees allocated once; owner corrections reflected in terminal history',()=>{
 const s=seed();s.recipes.push({...s.recipes[0],id:'r2',name:'Burger'});const out=applyPosOrder(s,{...input(),items:[{recipeId:'r',quantity:1},{recipeId:'r2',quantity:1}]},actor,when).state;
 assert.equal(new Set(out.sales.map(s=>s.deliveryBatchId)).size,1);assert.equal(out.sales.reduce((sum,s)=>sum+s.deliveryCommissionAmount,0),8848);
 const corrected={...out,sales:out.sales.map((s,i)=>i? s:{...s,totalRevenue:15000,unitPrice:15000})};assert.equal(buildPosTerminalView(corrected).orders[0].total,28900);assert.equal(buildPosTerminalView({...out,sales:[]}).orders.length,0);
});

test('rahbar delivery buyurtmasida platforma ushlagan haqiqiy summani yozadi; xodim yoza olmaydi',()=>{
 const s=seed();
 assert.throws(()=>applyPosOrder(s,{...input(),deliveryFeeOverrideWon:5000},actor,when),/faqat rahbar/);
 assert.throws(()=>applyPosOrder(s,{...input(),deliveryFeeOverrideWon:99999},actor,when,{ownerEntry:true}),/oralig/);
 const a=applyPosOrder(s,{...input(),deliveryFeeOverrideWon:'5,000'},actor,when,{ownerEntry:true}).state;
 assert.equal(a.sales.reduce((n,x)=>n+x.deliveryCommissionAmount,0),5000);
 const b=applyPosOrder(s,input(),actor,when,{ownerEntry:true}).state;
 assert.notEqual(b.sales.reduce((n,x)=>n+x.deliveryCommissionAmount,0),5000);
});
