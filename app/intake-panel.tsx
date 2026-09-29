"use client";
import { useRef, useState } from 'react';
import { findIntakeProduct, intakeUnitOptions, intakeFormProblems } from './lib/intake-form';
import { parseIntakeText } from './lib/intake-text';
import { planIntakeLine } from './lib/unified-intake';
import { expenseOnlyOnDate, type ExpenseOnlyFields } from './lib/vegetable-expenses';
type Item = ExpenseOnlyFields & {id:string;name:string;unit:string;unitsPerPackage:number;packageName:string};
type Line = {name:string;inventoryId?:string;quantity:string;unit:string;amount:string;expenseConfirmed?:boolean};
export type IntakeDraft = {lines:Line[];supplier:string;date:string;paid?:string;account?:string;invoice?:string;duplicateReason?:string;operationId?:string};
const blank=():Line=>({name:'',quantity:'1',unit:'dona',amount:''});
const won=(n:number)=>`₩${Math.round(n||0).toLocaleString('en-US')}`;
export default function IntakePanel({inventory,transactions,movements,today,onSave,onMezana,onVegetables,onInventory,onManage,initialDraft,onRemove}:{inventory:Item[];suppliers:{id:string;name:string}[];accounts:{id:string;name:string}[];transactions:any[];movements:any[];today:string;onSave:(body:Record<string,unknown>)=>Promise<void>;onMezana:()=>void;onVegetables:()=>void;onInventory:(draft:IntakeDraft,name?:string)=>void;initialDraft?:IntakeDraft;onManage:(id?:string)=>void;onRemove:(id:string,label:string)=>void}) {
 const [text,setText]=useState(''),[duplicateReason,setDuplicateReason]=useState(''),[similar,setSimilar]=useState(false);
 const [lines,setLines]=useState<Line[]>(initialDraft?.lines||[blank()]),[date,setDate]=useState(initialDraft?.date||today),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const lock=useRef(false),operation=useRef(initialDraft?.operationId||'');
 const plans=lines.map(line=>{try{const planned=planIntakeLine(inventory,line,date);return {line:planned,error:planned.destination==='vegetableExpense'?'Bu mahsulotni Sabzavot va sous zaxirasiga kiriting.':''};}catch(e){return {line:null,error:(e as Error).message};}});
 const total=lines.reduce((sum,line)=>sum+(Number(line.amount)||0),0);
 const problems=intakeFormProblems({inventoryOnly:true,supplier:'',date,paid:'',total,accountId:'',accounts:[],plans,lines,similar,duplicateReason});
 const change=(index:number,patch:Partial<Line>)=>{setLines(current=>current.map((line,i)=>i===index?{...line,...patch}:line));setSimilar(false);setDuplicateReason('');setNotice('');};
 const openProduct=(name?:string)=>onInventory({lines,supplier:'',date,operationId:operation.current},name);
 const submit=async()=>{if(lock.current)return;if(problems.length){setNotice(problems[0]);return;}lock.current=true;setBusy(true);setNotice('');try{operation.current ||= crypto.randomUUID();await onSave({inventoryOnly:true,operationId:operation.current,date,lines,duplicateReason});operation.current='';setLines([blank()]);setDuplicateReason('');setSimilar(false);setNotice('✓ Ombor kirimi saqlandi. Qarz va to‘lov yaratilmagan.');}catch(e){setNotice((e as Error).message);setSimilar((e as Error & {code?:string}).code==='SIMILAR_PURCHASE');}finally{lock.current=false;setBusy(false);}};
 const recent=[...movements.filter(m=>m.type==='receipt'&&m.supplierAccounting==='separate').map(m=>({id:m.id,date:m.date,amount:m.purchaseAmount??Number(m.quantity)*Number(m.unitCost||0),lines:[{name:inventory.find(i=>i.id===m.inventoryId)?.name||m.note,quantity:m.purchaseQuantity??m.quantity,unit:m.purchaseUnit||inventory.find(i=>i.id===m.inventoryId)?.unit,amount:m.purchaseAmount??Number(m.quantity)*Number(m.unitCost||0)}],legacy:false})),...transactions.filter(t=>t.intakeLines).map(t=>({id:t.id,date:t.date,amount:t.amount,lines:t.intakeLines,legacy:true}))].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,10);
 return <div className="page intake-page"><section className="panel intake-panel">
 <div className="panel-head"><div><h2>Omborga mahsulot kiritish</h2><p>Mahsulot, miqdor, narx va sana. Qarz va to‘lovni yetkazib beruvchilar bo‘limida alohida kiriting.</p></div><div><button type="button" disabled={busy} onClick={onVegetables}>Sabzavot va sous kiritish →</button><button type="button" disabled={busy} onClick={onMezana}>MEZANAdan olindi</button></div></div>
 <fieldset disabled={busy} className="intake-fields"><label>Sana<input type="date" max={today} value={date} onChange={e=>{setDate(e.target.value);setSimilar(false);setDuplicateReason('');}}/></label></fieldset>
 <datalist id="intake-products">{inventory.filter(item=>!expenseOnlyOnDate(item,date)).map(item=><option key={item.id} value={item.name}/>)}</datalist>
 {lines.map((line,index)=><fieldset key={index} disabled={busy} className="intake-line">
 <label>Mahsulot<input list="intake-products" value={line.name} maxLength={100} onChange={e=>{const item=findIntakeProduct(inventory,e.target.value);change(index,{name:e.target.value,inventoryId:item?.id||'',...(item?{unit:item.unit}:{})});}} placeholder="Mahsulot nomi"/></label>
 <label>Miqdor<input type="number" min="0.001" step="any" value={line.quantity} onChange={e=>change(index,{quantity:e.target.value})}/></label>
 <label>Birlik<select value={line.unit} onChange={e=>change(index,{unit:e.target.value})}>{intakeUnitOptions(findIntakeProduct(inventory,line.name)).map(unit=><option key={unit} value={unit}>{unit==='qadoq'?`Qadoq · ${findIntakeProduct(inventory,line.name)?.unitsPerPackage||1} ${findIntakeProduct(inventory,line.name)?.unit||'birlik'}`:unit}</option>)}</select></label>
 <label>Jami narx · ₩<input type="number" min="1" step="1" value={line.amount} onChange={e=>change(index,{amount:e.target.value})}/></label>
 <button type="button" disabled={lines.length===1} onClick={()=>{setLines(lines.filter((_,i)=>i!==index));setSimilar(false);}}>Olib tashlash</button>
 <p className="intake-destination">{plans[index].line?.destination==='stock'?`Omborga: ${plans[index].line!.stockQuantity} ${inventory.find(i=>i.id===plans[index].line!.inventoryId)?.unit}.` : plans[index].line?.destination==='vegetableExpense'?'Sabzavot va sous zaxirasiga yoziladi.':line.name&&line.amount?plans[index].error||'Mahsulot omborda yo‘q. Avval mahsulotni yarating.':'Nom, miqdor va jami narxni kiriting.'} {Number(line.quantity)>0&&Number(line.amount)>0?`1 ${line.unit} narxi: ${won(Number(line.amount)/Number(line.quantity))}`:''}</p>
 {plans[index].line?.destination==='expense'&&<button type="button" onClick={()=>openProduct(line.name)}>+ Shu mahsulotni yaratish</button>}
 </fieldset>)}
 <button type="button" disabled={busy||lines.length>=50} onClick={()=>setLines([...lines,blank()])}>+ Yana mahsulot</button>
 <p>Jami: <strong>{won(total)}</strong></p>
 {similar&&<label>Bu boshqa kirim bo‘lsa, sababini yozing<input value={duplicateReason} maxLength={300} disabled={busy} onChange={e=>setDuplicateReason(e.target.value)} placeholder="Masalan: shu kuni yana mahsulot keldi"/></label>}
 {notice&&<p role="status" className="form-notice">{notice}</p>}
 <button type="button" disabled={busy} onClick={()=>void submit()}>{busy?'Saqlanmoqda…':'Omborga saqlash'}</button>
 <details className="intake-text"><summary>Mahsulotlarni ro‘yxat bilan kiritish</summary><p>Har qatorda: nom, miqdor, birlik, jami narx.</p><textarea rows={4} disabled={busy} value={text} onChange={e=>setText(e.target.value)} placeholder={"Un 2 kg 8000\nYog‘ 1 litr 3500"}/><button type="button" disabled={busy} onClick={()=>{try{const parsed=parseIntakeText(text);if(lines.some(l=>l.name||l.amount)&&!window.confirm('Jadvaldagi qatorlar yozilgan ro‘yxat bilan almashtirilsinmi?'))return;setLines(parsed);setSimilar(false);setNotice('Jadval tayyor. Tekshirib, saqlang.');}catch(e){setNotice((e as Error).message);}}}>Jadvalga o‘tkazish</button></details>
 </section><section className="panel intake-panel"><h3>Oxirgi kirimlar</h3><button type="button" onClick={()=>onManage()}>Barcha kirimlar / tahrirlash →</button>{recent.map(r=><details key={r.id}><summary>{r.date} · {won(r.amount)}</summary>{r.lines.map((line:any,index:number)=><p key={index}>{line.name} · {line.quantity} {line.unit} · {won(line.amount)}</p>)}<p>{r.legacy?'Avvalgi tartibda saqlangan kirim. Bog‘langan hisoblar saqlangan.':'Faqat ombor kirimi. Yetkazib beruvchi qarzi va to‘lov alohida.'}</p><button type="button" disabled={busy} onClick={()=>onManage(r.id)}>Tahrirlash</button><button type="button" className="danger remove-record" disabled={busy} onClick={()=>onRemove(r.id,`${r.date} · ${r.lines.map((l:any)=>l.name).join(", ")} · ${won(r.amount)}`)}>Olib tashlash</button></details>)}{!recent.length&&<p>Kirimlar shu yerda ko‘rinadi.</p>}</section></div>;
}
