"use client";
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { RemovalTarget } from './lib/record-removals';
import './record-removal.css';
type Row=Record<string,any>;
export default function RecordRemovalDialog({branchId,target,onClose,onRemoved,onBeforeRemove}:{branchId:string;target:RemovalTarget|null;onClose:()=>void;onRemoved:()=>Promise<void>;onBeforeRemove?:()=>Promise<void>}) {
  const ref=useRef<HTMLDialogElement>(null),lock=useRef(false);
  const [preview,setPreview]=useState<Row|null>(null),[reason,setReason]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0),[saved,setSaved]=useState(false);
  const operation=useRef('');
  useEffect(()=>{
    if(!target)return;
    const abort=new AbortController();operation.current=crypto.randomUUID();setPreview(null);setError('');setSaved(false);setReason('');
    ref.current?.showModal();
    void (async()=>{try{await onBeforeRemove?.();const response=await fetch(`/api/record-removals?branch=${encodeURIComponent(branchId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...target,action:'preview'}),signal:abort.signal});const result=await response.json();if(!response.ok)throw new Error(result.error);if(!abort.signal.aborted)setPreview(result);}catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Tekshiruv ochilmadi.');}})();
    return()=>abort.abort();
  },[target?.kind,target?.id,branchId,version]);
  const remove=async()=>{
    if(!target||!preview||lock.current||saved)return;lock.current=true;setBusy(true);setError('');
    try{await onBeforeRemove?.();const response=await fetch(`/api/record-removals?branch=${encodeURIComponent(branchId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...target,action:'remove',reason,expected:preview.expected,operationId:operation.current})});const result=await response.json();if(!response.ok)throw new Error(result.error);setSaved(true);try{await onRemoved();onClose();}catch{setError('Olib tashlash saqlandi. Ro‘yxatni yangilash uchun sahifani qayta oching.');}}
    catch(e){setError(e instanceof Error?e.message:'Amal saqlanmadi.');}finally{lock.current=false;setBusy(false);}
  };
  if(!target||typeof document==='undefined')return null;
  const number=(n:number,unit:string)=>`${Number(n).toLocaleString('en-US',{maximumFractionDigits:4})} ${unit}`;
  return createPortal(<dialog className="record-removal-dialog" ref={ref} onCancel={e=>{e.preventDefault();if(!busy)onClose();}} aria-labelledby="removal-title">
    <h2 id="removal-title">Yozuvni olib tashlash</h2><p className="removal-label">{target.label||target.id}</p>
    {!preview&&!error&&<p role="status">Bog‘langan hisoblar tekshirilmoqda…</p>}
    {preview&&<><p>{preview.description}</p><div className="removal-effects">{preview.effects.length?<table><thead><tr><th>Hisob</th><th>Hozir</th><th>Keyin</th></tr></thead><tbody>{preview.effects.map((e:Row,i:number)=><tr key={i}><th>{e.label}</th><td>{number(e.before,e.unit)}</td><td>{number(e.after,e.unit)}</td></tr>)}</tbody></table>:<p>Pul, qarz va oddiy ombor qoldig‘i o‘zgarmaydi.</p>}</div>
      <p>Bu xato yozuvni bekor qiladi. Asl ma’lumot tarixda saqlanadi.</p><label>Sababi<textarea maxLength={300} minLength={3} value={reason} disabled={busy||saved} placeholder="Masalan: ikki marta kiritilgan" onChange={e=>setReason(e.target.value)}/></label></>}
    {error&&<p role="alert" className="removal-error">{error}</p>}
    <div className="removal-actions"><button type="button" disabled={busy} onClick={onClose}>{saved?'Yopish':'Qoldirish'}</button>{!saved&&<><button type="button" disabled={busy} onClick={()=>setVersion(v=>v+1)}>Qayta tekshirish</button><button type="button" className="danger" disabled={busy||!preview||reason.trim().length<3} onClick={()=>void remove()}>{busy?'Saqlanmoqda…':'Tasdiqlash va olib tashlash'}</button></>}</div>
  </dialog>,document.body);
}
