"use client";
import { supplierLedger } from './lib/supplier-ledger';
const won=(v:number)=>`₩${v.toLocaleString('en-US')}`;
export default function SupplierLedgerPanel({supplier,transactions,movements,inventory}:{supplier:Record<string,any>;transactions:Record<string,any>[];movements:Record<string,any>[];inventory:Record<string,any>[]}){
 const ledger=supplierLedger(supplier,transactions,movements,inventory);
 return <details className="supplier-product-details"><summary>To‘liq oldi-berdi: xarid → to‘lov → qolgan qarz</summary><p>Barcha sanalar · boshlang‘ich qoldiq: {won(ledger.opening)}. Qoldiq sana tartibida qayta hisoblangan; eski yozuvlarda soat mavjud emas.</p>
 {(ledger.difference!==0||ledger.incomplete)&&<p role="alert">Tarix va ko‘rsatilgan qoldiqni tekshiring. Farq: {won(ledger.difference)}. Hisob avtomatik o‘zgartirilmadi.</p>}
 <div style={{overflowX:'auto'}}><table style={{width:'100%',minWidth:580}}><thead><tr>{['Sana','Mahsulot / izoh','Xarid','To‘lov','Tuzatish','Qolgan qarz'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>
 <tr><td>Avvalgi qoldiq</td><td colSpan={4}/><td>{won(ledger.opening)}</td></tr>
 {ledger.entries.map(e=><tr key={e.id}><td>{e.date}</td><td>{e.items.length?e.items.join(', '):e.note||'—'}{e.kind==='adjustment'?' · qoldiq tuzatishi':''}</td><td>{e.kind==='purchase'?won(e.amount):'—'}</td><td>{e.kind==='payment'?won(e.amount):'—'}</td><td>{e.kind==='adjustment'?won(e.amount):'—'}</td><td>{e.balance<0?`Avans ${won(-e.balance)}`:won(e.balance)}</td></tr>)}
 </tbody></table></div><p>Hozirgi hisoblangan qoldiq: <b>{won(ledger.balance)}</b>. To‘lov xarajatga ikkinchi marta qo‘shilmaydi.</p></details>;
}
