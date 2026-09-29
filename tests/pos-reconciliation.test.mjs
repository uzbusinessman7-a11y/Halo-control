import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPosTable, autoDetectPosColumns, parsePosRows } from '../app/pos-import.ts';
import { reconcilePosImport, newPosDuplicateId } from '../app/lib/pos-reconciliation.ts';

// Quantities and amounts from the supplied 23 September OKPOS report.
const items = [
  ['000044',8,103200],['000045',6,83400],['000003',4,79600],['000023',6,71400],
  ['000046',5,69500],['000031',5,39500],['000034',3,38700],['000018',3,35700],
  ['000002',4,34000],['000066',2,29800],['000038',2,23800],['000019',2,21800],
  ['000041',7,21000],['000033',2,19800],['000064',2,17800],['000032',2,17800],
  ['000011',5,15000],['000065',1,13900],['000039',1,12900],['000009',5,10000],
  ['000042',3,9000],['000043',2,6000],['000007',1,3900],['000063',1,3000],['000035',2,2000],
];
const table = extractPosTable([
  ['당일매출종합현황 (상품별 매출현황)'],['조회일자 : 2026-09-23'],
  ['No.','상품코드','상품명','수량','실매출'],
  ...items.map(([code,qty,total],i)=>[i+1,code,'Menu',qty,total]),['합계','','',84,782500],
], 'daily.xls','Sheet');
const parsed = parsePosRows(table,autoDetectPosColumns(table.headers),'2026-09-25');
const rows = parsed.rows.map(row=>({...row,recipeId:row.productCode,menuRevenue:row.referenceRevenue}));
const saved = rows.map((row,i)=>({id:`sale-${i}`,recipeId:row.recipeId,date:row.date,quantity:row.quantity,totalRevenue:row.menuRevenue,source:'pos',externalId:row.externalId}));

test('supplied XLS preserves 782500 won, 84 items, 25 codes and its own date',()=>{
  assert.equal(table.reportDate,'2026-09-23');
  assert.equal(parsed.summary.totalRevenue,782500);
  assert.equal(parsed.summary.parsedQuantity,84);
  assert.equal(rows.length,25);
  assert.equal(rows.reduce((s,row)=>s+row.referenceRevenue,0),782500);
  assert.equal(rows.reduce((sum,row)=>sum+row.totalRevenue,0),782500,'actual POS revenue must override current menu pricing');
  assert.equal(parsed.ignored,0,'grand total is not a bad sales row');
  assert.equal(parsed.summaryRows,1);
  assert.equal(rows.find(row=>row.productCode==='000009').quantity,5);
});
test('partial import distinguishes file total from 10 new and 15 saved rows',()=>{
  const result=reconcilePosImport(rows,saved.slice(0,15));
  assert.equal(result.newRows.length,10);
  assert.equal(result.savedRows.length,15);
  assert.equal(result.menuRevenue,782500);
  assert.equal(result.projectedRevenue,782500);
  assert.equal(result.savedRevenue+result.newRevenue,782500);
  assert.ok(result.newRevenue<result.menuRevenue);
});
test('reuploading or renaming a complete report adds no sales',()=>{
  const renamed=parsePosRows({...table,fileName:'renamed.xls'},autoDetectPosColumns(table.headers),'2026-09-25');
  assert.deepEqual(renamed.rows.map(r=>r.externalId),rows.map(r=>r.externalId));
  const result=reconcilePosImport(rows,saved);
  assert.equal(result.newRows.length,0);
  assert.equal(result.savedRows.length,25);
  assert.equal(result.projectedRevenue,782500);
});
test('a changed same-date quantity or recipe is a visible conflict, never silently skipped',()=>{
  for(const change of [{quantity:9},{recipeId:'another-menu'},{date:'2026-09-24'}]){
    const result=reconcilePosImport([{...rows[0],...change}],saved.slice(0,1));
    assert.equal(result.conflicts.length,1);
    assert.equal(result.conflicts[0].savedQuantity,8);
    assert.equal(result.savedRows.length,0);
    assert.equal(result.newRows.length,0);
    assert.equal(result.projectedRevenue,null);
  }
});
test('repeated identities in file or stored data block the preview',()=>{
  assert.equal(reconcilePosImport([rows[0],{...rows[0],rowNumber:99}],[]).conflicts.length,2);
  const result=reconcilePosImport([rows[0]],[saved[0],{...saved[0],id:'duplicate'}]);
  assert.equal(result.conflicts[0].conflict,'saved_duplicate');
});
test('historical revenue stays frozen when the current menu price changes',()=>{
  const result=reconcilePosImport([{...rows[0],menuRevenue:200000}],[saved[0]]);
  assert.equal(result.menuRevenue,200000);
  assert.equal(result.savedRevenue,103200);
  assert.equal(result.projectedRevenue,103200);
  assert.equal(result.conflicts.length,0);
});
test('server rejects new repeated POS IDs without blocking unrelated legacy records',()=>{
  assert.equal(newPosDuplicateId([saved[0]],[saved[0],{...saved[0],id:'retry'}]),saved[0].externalId);
  assert.equal(newPosDuplicateId([], [saved[0],{...saved[0],id:'second'}]),saved[0].externalId);
  const legacy=[saved[0],{...saved[0],id:'old-duplicate'}];
  assert.equal(newPosDuplicateId(legacy,legacy),'');
  assert.equal(newPosDuplicateId([saved[0]],[saved[0],{...saved[1],id:'new'}]),'');
});
test('unmatched products prevent claiming a complete projected total; checks never mutate data',()=>{
  const before=JSON.stringify({rows,saved});
  const result=reconcilePosImport([{...rows[0],recipeId:''}],[]);
  assert.equal(result.projectedRevenue,null);
  assert.equal(result.unmatchedRows.length,1);
  assert.equal(JSON.stringify({rows,saved}),before);
});

test('an actual POS amount overrides menu estimates and an explicit zero remains zero',()=>{
  assert.equal(reconcilePosImport([{...rows[0],menuRevenue:999999}],[]).newRevenue,103200);
  assert.equal(reconcilePosImport([{...rows[0],totalRevenue:0,menuRevenue:999999}],[]).newRevenue,0);
  const revised=reconcilePosImport([{...rows[0],totalRevenue:103199}],[saved[0]]);
  assert.equal(revised.conflicts[0].conflict,'changed','one-won difference must not silently disappear');
});
test('redacted employee records can compare identity and quantity without exposing money',()=>{
  const redacted={...saved[0],totalRevenue:undefined};
  assert.equal(reconcilePosImport([rows[0]],[redacted],{compareRevenue:false}).savedRows.length,1);
  assert.equal(reconcilePosImport([{...rows[0],quantity:9}],[redacted],{compareRevenue:false}).conflicts.length,1);
});
test('negative refund, missing money, and multi-day aggregates cannot become ordinary sales',()=>{
  for(const values of [[-1,-1000],[1,''],[1,'unknown'],[1,-1000]]){
    const input=extractPosTable([['상품코드','수량','실매출'],['0001',...values]],'test.xls','Sheet');
    assert.ok(parsePosRows(input,autoDetectPosColumns(input.headers),'2026-09-25').errors.length);
  }
  const range=extractPosTable([['조회일자 : 2026-09-01 ~ 2026-09-25'],['상품코드','수량','실매출'],['0001',1,1000]],'range.xls','Sheet');
  assert.ok(parsePosRows(range,autoDetectPosColumns(range.headers),'2026-09-25').errors.length);
});
test('net sales take priority over gross totals and discount is not deducted twice',()=>{
  const input=extractPosTable([['상품코드','수량','매출액','할인','실매출'],['0001',1,10000,2000,8000]],'net.xls','Sheet');
  const parsed=parsePosRows(input,autoDetectPosColumns(input.headers),'2026-09-25');
  assert.equal(parsed.rows[0].totalRevenue,8000);
  assert.equal(parsed.rows[0].revenueSource,'pos_actual');
  assert.equal(parsed.errors.length,0);
});
