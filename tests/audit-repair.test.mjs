import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAccountBalances } from '../app/lib/account-balances.ts';
import { receiptDisplay, receiptTotalRows } from '../app/lib/receipt-display.ts';
import { supplierSourceDocument } from '../app/lib/supplier-source.ts';
import { calculateRecipeMarginAudit } from '../app/lib/recipe-costing.ts';

test('cash balances exclude non-cash costs, preserve profit records, and reconcile visible accounts', () => {
  const state = { accounts: [{id:'cash',openingBalance:1000000},{id:'bank',openingBalance:0}], sales:[
    {id:'sale',date:'2026-09-27',accountId:'cash',totalRevenue:100000},
    {id:'cancelled',date:'2026-09-27',accountId:'cash',totalRevenue:50000,cancelledAt:'now'},
    {id:'future',date:'2026-09-28',accountId:'cash',totalRevenue:50000},
  ], financialEntries:[
    {id:'sauce',date:'2026-09-27',type:'expense',amount:198000,nonCash:true,accountId:'',affectsProfit:true},
    {id:'paid',date:'2026-09-27',type:'expense',amount:50000,accountId:'cash',affectsProfit:false},
    {id:'move',date:'2026-09-27',type:'transfer',amount:20000,accountId:'cash',toAccountId:'bank'},
    {id:'self',date:'2026-09-27',type:'transfer',amount:10000,accountId:'cash',toAccountId:'cash'},
    {id:'unknown',date:'2026-09-27',type:'expense',amount:333,accountId:'missing'},
    {id:'badtransfer',date:'2026-09-27',type:'transfer',amount:500,accountId:'cash',toAccountId:'missing'},
  ]};
  const original=structuredClone(state), result=calculateAccountBalances(state,'2026-09-27');
  assert.equal(result.balances.get('cash'),1030000); assert.equal(result.balances.get('bank'),20000);
  assert.equal(result.total,1050000); assert.equal(result.total,[...result.balances.values()].reduce((a,b)=>a+b,0));
  assert.deepEqual(result.unmatched,['unknown','badtransfer']); assert.deepEqual(state,original);
});

test('sauce receipt 30 kg/198000 is visible without changing its zero physical stock movement', () => {
  const movement={id:'sauce',inventoryId:'s',quantity:0,purchaseQuantity:30,purchaseUnit:'kg',purchaseBaseQuantity:30000,purchaseAmount:198000,unitCost:6.6,date:'2026-09-27'};
  const original=structuredClone(movement);
  assert.deepEqual(receiptDisplay(movement,{unit:'g'}),{quantity:30,unit:'kg',amount:198000,unitCost:6600});
  const total=receiptTotalRows([movement,{inventoryId:'s',quantity:32000,unitCost:6,date:'2026-09-20'}],[{id:'s',name:'SOUS',unit:'g'}]);
  assert.equal(total[0].quantity,62000); assert.equal(total[0].amount,390000);
  const packages=receiptTotalRows([movement,{...movement,purchaseQuantity:1,purchaseUnit:'quti',purchaseAmount:1000}],[{id:'s',name:'SOUS',unit:'g'}]);
  assert.equal(packages.length,2); assert.deepEqual(movement,original);
  assert.equal(receiptDisplay({quantity:3}).amount,null);
});

test('source links use explicit IDs and never guess from equal money', () => {
  const state={transactions:[],stockMovements:[{id:'m',transactionId:'t'}],vegetablePurchases:[{id:'v',transactionId:'sauce',movementId:'sauce-receipt'}]};
  assert.equal(supplierSourceDocument(state,{id:'t'}),'m');
  assert.equal(supplierSourceDocument(state,{id:'sauce'}),'sauce-receipt');
  assert.equal(supplierSourceDocument(state,{id:'unrelated',amount:198000}),null);
  assert.equal(supplierSourceDocument({...state,stockMovements:[{id:'legacy',referenceId:'old'}]},{id:'old'}),'legacy');
});

test('expense-only recipe costing diagnoses absent current price despite old saved ingredient cost', () => {
  const recipe={id:'r',name:'Taom',salePrice:10000,ingredients:[{inventoryId:'s',quantity:100,unit:'g',unitCost:5,lineCost:500}]};
  const audit=calculateRecipeMarginAudit(recipe,[{id:'s',name:'SOUS',unit:'g',unitCost:0,expenseOnly:true}]);
  assert.equal(audit.complete,false);
});
