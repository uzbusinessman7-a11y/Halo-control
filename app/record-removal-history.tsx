"use client";
import {useEffect,useState} from 'react';
import './record-removal.css';
export default function RecordRemovalHistory({branchId}:{branchId:string}){
 const [history,setHistory]=useState<any[]>([]),[error,setError]=useState(''),[limit,setLimit]=useState(30);
 useEffect(()=>{const abort=new AbortController();fetch(`/api/record-removals?branch=${encodeURIComponent(branchId)}`,{signal:abort.signal}).then(async r=>{const v=await r.json();if(!r.ok)throw new Error(v.error);setHistory(v.history);}).catch(e=>{if(!abort.signal.aborted)setError(e.message);});return()=>abort.abort();},[branchId]);
 return <section className="panel removal-history"><h3>Olib tashlash tarixi</h3><p>Asl yozuvlar saqlanadi. Bu amallar qayta hisobga qo‘shilmaydi.</p>{error&&<p role="alert">{error}</p>}{history.slice(0,limit).map(r=><details key={r.id}><summary>{new Date(r.at).toLocaleString('uz-UZ',{timeZone:'Asia/Seoul'})} · {r.label}</summary><p>{r.by} · {r.reason}</p>{r.effects.map((e:any,i:number)=><p key={i}>{e.label}: {Number(e.before).toLocaleString()} → {Number(e.after).toLocaleString()} {e.unit}</p>)}</details>)}{!history.length&&!error&&<p>Bu oynadan olib tashlangan yozuvlar hali yo‘q.</p>}{history.length>limit&&<button type="button" onClick={()=>setLimit(n=>n+30)}>Yana ko‘rsatish</button>}</section>;
}
