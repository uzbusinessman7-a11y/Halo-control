import test from 'node:test';
import assert from 'node:assert/strict';
import {withSimpleDeliveryRule, deliveryFeeRuleForPlatform, deliveryAutomaticManualFees, calculateDeliveryManualFees} from '../app/lib/delivery-sales.ts';
import {applyPosOrder} from '../app/lib/pos-terminal.ts';
import {calculateDailyReport} from '../app/lib/daily-report.ts';

const setting = {combinedPct:16,deliveryFeeWon:3400,instantDiscountWon:1000};
const base = () => ({taxPct:10,cardCommissionPct:1.6,deliveryCommissionPct:0,deliveryPlatformRules:{baemin:{brokeragePct:6.8,paymentPct:3,vatPct:10,couponPct:2,advertisingPct:1,deliveryFeeWon:2900,instantDiscountWon:0}}});

test('saving Coupang keeps POS and other platform rules, validates without silent clamping',()=>{
  const rules=base(),before=structuredClone(rules);
  const saved=withSimpleDeliveryRule(rules,'coupang',setting);
  assert.deepEqual(rules,before);
  assert.deepEqual(saved.deliveryPlatformRules.baemin,rules.deliveryPlatformRules.baemin);
  assert.equal(saved.cardCommissionPct,1.6); assert.equal(saved.taxPct,10);
  for (const patch of [{combinedPct:101},{combinedPct:-1},{combinedPct:NaN},{deliveryFeeWon:0.5},{instantDiscountWon:-1}]) {
    assert.throws(()=>withSimpleDeliveryRule(rules,'coupang',{...setting,...patch}));
  }
  const zero=withSimpleDeliveryRule(rules,'coupang',{combinedPct:0,deliveryFeeWon:0,instantDiscountWon:0});
  assert.equal(calculateDeliveryManualFees(26000,deliveryAutomaticManualFees(deliveryFeeRuleForPlatform(zero,'coupang'))).total,0);
});

test('saved tax settings deduct every employee order once and preserve historical amounts after a rule change',()=>{
  const state={inventory:[{id:"bread",name:"NON",unit:"dona",stock:100,unitCost:500}],stockMovements:[],sales:[],posOrders:[],monthlyCloses:[],transactions:[],fixedExpenses:[],workShifts:[],employees:[],financialEntries:[],workerConsumptions:[],accounts:[{id:'delivery',type:'delivery'}],recipes:[{id:'r1',name:'Lavash',salePrice:11000,deliveryPrices:{coupang:16000},ingredients:[{inventoryId:"bread",quantity:1}]},{id:'r2',name:'Burger',salePrice:8000,deliveryPrices:{coupang:10000},ingredients:[{inventoryId:"bread",quantity:1}]}],costRules:withSimpleDeliveryRule(base(),'coupang',setting)};
  const actor={id:'worker',name:'Ali'},when='2026-09-26T10:00:00Z';
  const input={operationId:'delivery-setting-order-001',paymentType:'delivery',deliveryPlatform:'coupang',date:'2026-09-26',expectedTotal:26000,items:[{recipeId:'r1',quantity:1},{recipeId:'r2',quantity:1}],deliveryFeesWon:{brokerage:0,delivery:0}};
  const first=applyPosOrder(state,input,actor,when).state;
  assert.equal(first.sales.reduce((s,r)=>s+r.totalRevenue,0),26000);
  assert.equal(first.sales.reduce((s,r)=>s+r.deliveryCommissionAmount,0),8560);
  assert.equal(first.sales.reduce((s,r)=>s+r.deliveryFeeBreakdown.delivery,0),3400);
  assert.equal(first.sales.reduce((s,r)=>s+r.deliveryFeeBreakdown.instantDiscount,0),1000);
  assert.equal(26000-8560,17440);
  const history=structuredClone(first.sales);
  const second=applyPosOrder(first,{...input,operationId:'delivery-setting-order-002'},actor,when).state;
  assert.equal(second.sales.reduce((s,r)=>s+r.deliveryCommissionAmount,0),17120);
  assert.equal(applyPosOrder(second,{...input,operationId:'delivery-setting-order-002'},actor,when).result.alreadySaved,true);
  const changed={...first,costRules:withSimpleDeliveryRule(first.costRules,'coupang',{combinedPct:10,deliveryFeeWon:3000,instantDiscountWon:0})};
  const third=applyPosOrder(changed,{...input,operationId:'delivery-setting-order-003'},actor,when).state;
  assert.deepEqual(third.sales.filter(row=>history.some(old=>old.id===row.id)),history);
  assert.equal(third.sales.reduce((s,r)=>s+r.deliveryCommissionAmount,0),8560+5600);
  const report=calculateDailyReport(third,'2026-09-26');
  assert.equal(report.deliverySales,52000); assert.equal(report.deliveryCommission,14160);
  assert.equal(report.cardCommission,0); assert.equal(report.tax,0);
  assert.deepEqual(state.sales,[]);
});
