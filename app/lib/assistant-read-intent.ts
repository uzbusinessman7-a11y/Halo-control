type Row=Record<string,any>;
const norm=(v:unknown)=>String(v||'').normalize('NFKC').toLowerCase().replace(/[‘’ʻʼ`']/g,'').replace(/[^\p{L}\p{N}\s-]/gu,' ').replace(/\s+/g,' ').trim();
const escape=(s:string)=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Only route explicit reads; ambiguous and compound commands stay with the AI. */
export function localReadIntent(text:string,state:Row,today:string):Row|null{
 const t=norm(text);
 if(/\b(kirit|krit|saqla|ochir|tuzat|tola|tolo|oldim|qosh|qaytar|bekor|tahrir)/.test(t)||/\b(va|keyin)\b/.test(t))return null;
 // Do not silently discard a requested date/filter that this small parser cannot resolve.
 if(/\d|\b(kecha|bugun|oy|hafta|sentyabr|sentabr|avgust|yanvar|fevral|mart|aprel|may|iyun|iyul|oktyabr|noyabr|dekabr|oxirgi)\b/.test(t))return null;
 const products=/(mahsulot|maxsulot|nima|nimalar|tovar|tavar)/.test(t)&&/(olingan|olgan|kelgan|royxat|royhat|nima|nimalar)/.test(t);
 const debts=/qarz/.test(t)&&/(qancha|qoldiq|korsat|bormi)/.test(t);
 if(!products&&!debts||/\b(pdf|excel|csv|fayl|yuklab)\b/.test(t))return null;
 const suppliers=(Array.isArray(state.suppliers)?state.suppliers:[]).filter((s:Row)=>!/mezana/i.test(s.name));
 const found=suppliers.filter((s:Row)=>{
  const name=norm(s.name);const aliases=[name,name.replace(/\s+(aka|opa|uka)$/,'')].filter(Boolean);
  return aliases.some(n=>new RegExp(`(?:^| )${escape(n)}(?:dan|ga|ning|ni)?(?= |$)`,'u').test(t));
 });
 if(found.length===1)return {kind:products?'supplier_products':'debts',query:found[0].name,supplierId:found[0].id};
 if(found.length>1)return {kind:'clarify',question:'Qaysi yetkazuvchi? '+found.map((s:Row)=>s.name).join(', ')+'. To‘liq nomini yozing.'};
 return null;
}
