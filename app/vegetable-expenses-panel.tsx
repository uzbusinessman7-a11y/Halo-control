"use client";
import RecordRemovalDialog from "./record-removal-dialog";
import type { RemovalTarget } from "./lib/record-removals";
import { useEffect, useMemo, useRef, useState } from 'react';
import { isExpenseOnlyInventory, type VegetablePeriod } from './lib/vegetable-expenses';
import { seoulCalendarDate, seoulClock } from './lib/business-time';
import './vegetable-expenses.css';
import PurchaseReservePanel from './purchase-reserve-panel';
import { vegetablePurchaseBody } from './lib/vegetable-purchase-form';
type Row = Record<string, any>;
const won = (n: number) => `₩${Math.round(n || 0).toLocaleString('en-US')}`;
const quantities = (value: Row) => Object.entries(value || {}).map(([unit, count]) => `${Number(count).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${unit}`).join(' · ');
const pct = (n: number | null) => n === null ? 'Savdo yo‘q' : `${n.toFixed(2)}%`;

function RatioChart({ points, norm }: { points: Row[]; norm: number }) {
  const maximum = Math.max(10, norm + 2, ...points.map(p => p.ratio || 0));
  const x = (i: number) => 48 + i / Math.max(1, points.length - 1) * 820;
  const y = (n: number) => 192 - n / maximum * 155;
  let connected = false;
  const path = points.map((p, i) => { if (p.ratio === null) { connected = false; return ''; } const d = `${connected ? 'L' : 'M'}${x(i)},${y(p.ratio)}`; connected = true; return d; }).join(' ');
  return <div className="veg-chart"><svg viewBox="0 0 900 235" role="img" aria-label="Davrlar bo‘yicha xarid summasining savdoga nisbati">
    {[0, maximum / 2, maximum].map(n => <g key={n}><line x1="48" x2="868" y1={y(n)} y2={y(n)} stroke="currentColor" opacity=".15"/><text x="4" y={y(n) + 4} fill="currentColor" fontSize="12">{n.toFixed(1)}%</text></g>)}
    <line x1="48" x2="868" y1={y(norm)} y2={y(norm)} stroke="#d9b86c" strokeDasharray="5 6"/><path d={path} fill="none" stroke="#70dbc5" strokeWidth="3"/>
    {points.map((p, i) => p.ratio === null ? null : <circle key={p.start} cx={x(i)} cy={y(p.ratio)} r="4" fill="#70dbc5"><title>{p.start}: {pct(p.ratio)} · sarf {won(p.expense)} · savdo {won(p.revenue)}</title></circle>)}
    {points.filter((_, i) => i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)).map(p => <text key={p.start} x={x(points.indexOf(p))} y="221" textAnchor={points.indexOf(p) === 0 ? 'start' : points.indexOf(p) === points.length - 1 ? 'end' : 'middle'} fill="currentColor" fontSize="12">{p.start}</text>)}
  </svg><p>Yashil chiziq — sarf / savdo. Sariq chiziq — me’yor. Ma’lumot yoki savdo bo‘lmasa, chiziqda uzilish bo‘ladi.</p></div>;
}

export default function VegetableExpensesPanel({ branchId, onSaved, onIntegrations }: { branchId: string; onSaved: () => Promise<unknown>; onIntegrations: () => void }) {
  const [removalTarget,setRemovalTarget]=useState<RemovalTarget|null>(null);
  const [newProduct,setNewProduct]=useState<Row|null>(null);
  const [view, setView] = useState<'reserve' | 'expenses'>('reserve');
  const [period, setPeriod] = useState<VegetablePeriod>('week'), [date, setDate] = useState(seoulCalendarDate());
  const [data, setData] = useState<Row | null>(null), [revision, setRevision] = useState(0), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [purchaseNotice, setPurchaseNotice] = useState(''), [similarPurchase, setSimilarPurchase] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false), [settingsOpen, setSettingsOpen] = useState(false), [search, setSearch] = useState(''), [norm, setNorm] = useState('6');
  const [purchase, setPurchase] = useState({ inventoryId: '', quantity: '', unit: 'dona', amount: '', date: seoulCalendarDate(), time: seoulClock(), remainingStatus: 'unknown', remaining: '' });
  const operation = useRef(''), lock = useRef(false);
  const reportCache = useRef(new Map<string, Row>());
  useEffect(() => { const abort = new AbortController(); let active = true; setLoading(true);
    const cacheKey = `${branchId}:${period}:${date}:${revision}`;
    const cached = reportCache.current.get(cacheKey);
    if (cached) setData(cached);
    const timer = window.setTimeout(() => abort.abort(), 15_000);
    fetch(`/api/vegetable-expenses?branch=${encodeURIComponent(branchId)}&period=${period}&date=${date}`, { signal: abort.signal }).then(async res => { const value = await res.json(); if (!res.ok) throw new Error(value.error); if (active) {
      reportCache.current.set(cacheKey, value);
      if (reportCache.current.size > 12) reportCache.current.delete(reportCache.current.keys().next().value!);
      setData(value); setNorm(String(value.settings?.normPct ?? 6));
    } }).catch(e => { if (active) setNotice(abort.signal.aborted ? 'Ulanish sekin. Avvalgi hisobot saqlandi; Yangilash tugmasini bosing.' : e.message || 'Hisobot ochilmadi.'); }).finally(() => { window.clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(timer); abort.abort(); };
  }, [branchId, period, date, revision]);
  useEffect(() => { operation.current = ''; setNewProduct(null); setPurchaseOpen(false); setPurchase({ inventoryId: '', quantity: '', unit: 'dona', amount: '', date: seoulCalendarDate(), time: seoulClock(), remainingStatus: 'unknown', remaining: '' }); }, [branchId]);
  useEffect(() => { const timer=window.setInterval(()=>{if(document.visibilityState==='visible' && !lock.current && !purchaseOpen && !settingsOpen && !newProduct)setRevision(n=>n+1);},60000); return ()=>window.clearInterval(timer); },[purchaseOpen,settingsOpen,newProduct]);
  const refreshAfterSave = () => {
    reportCache.current.clear(); setRevision(n => n + 1);
    // A confirmed save must not wait for the unrelated full-state refresh.
    void onSaved().catch(() => setNotice('✓ Amal saqlandi. Umumiy ma’lumotni yangilash kechikdi; sahifani yangilang.'));
  };
  const action = async (body: Row) => { if (lock.current) return false; lock.current = true; setBusy(true); setNotice(''); try {
    const res = await fetch(`/api/vegetable-expenses?branch=${encodeURIComponent(branchId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await res.json(); if (!res.ok) throw new Error(value.error); setNotice(body.action === 'reserveCount' ? '✓ Qoldiq qayd etildi. Zaxira taxmini yangilandi.' : '✓ Sozlama saqlandi. Oldingi yozuvlar o‘zgarmadi.'); refreshAfterSave(); return true;
  } catch (e) { setNotice((e as Error).message); return false; } finally { lock.current = false; setBusy(false); } };
  const saveProduct = async () => {
    if(lock.current || !newProduct)return;
    lock.current=true;setBusy(true);setNotice('');
    try {
      const res=await fetch(`/api/vegetable-expenses?branch=${encodeURIComponent(branchId)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'createProduct',...newProduct})});
      const value=await res.json();if(!res.ok)throw new Error(value.error);
      setPurchase(p=>({...p,inventoryId:value.inventoryId,unit:newProduct.unit,quantity:'',amount:'',remainingStatus:'unknown',remaining:''}));
      operation.current='';setNewProduct(null);setPurchaseOpen(true);setView('reserve');
      setNotice('✓ Yangi mahsulot qo‘shildi. Endi xarid miqdori va summasini kiriting.');refreshAfterSave();
    } catch(e){setNotice((e as Error).message);}finally{lock.current=false;setBusy(false);}
  };
  const savePurchase = async (separatePurchase = false) => {
    if (lock.current || !data) return;
    lock.current = true; setBusy(true); setPurchaseNotice(''); setNotice('');
    try {
      operation.current ||= crypto.randomUUID();
      const body = vegetablePurchaseBody(purchase, data, operation.current, separatePurchase ? 'Rahbar tasdiqladi: shu kuni alohida xarid qildim.' : '');
      const res = await fetch(`/api/intake?branch=${encodeURIComponent(branchId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const value = await res.json();
      if (!res.ok) { setSimilarPurchase(value.code === 'SIMILAR_PURCHASE'); throw new Error(value.error); }
      operation.current = ''; setSimilarPurchase(false);
      setPurchase(p => ({ ...p, quantity: '', amount: '', remainingStatus: 'unknown', remaining: '', time: seoulClock() }));
      setPurchaseOpen(false);
      setNotice('✓ Kirim saqlandi. Qarz va to‘lov yaratilmagan. Ularni yetkazib beruvchilar bo‘limida yuritasiz.');
      refreshAfterSave();
    } catch (e) { setPurchaseNotice((e as Error).message || 'Saqlanmadi. Qayta urinib ko‘ring.'); }
    finally { lock.current = false; setBusy(false); }
  };
  const openPurchase = () => { setPurchaseNotice(''); setSimilarPurchase(false); setNewProduct(null); setSettingsOpen(false); setPurchaseOpen(true); };
  const changePurchase = (changes: Row) => { setPurchase(p => ({ ...p, ...changes })); setPurchaseNotice(''); setSimilarPurchase(false); };
  const r = data?.report;
  const settingsProducts = useMemo(() => (data?.inventory || []).filter((i: Row) => i.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a: Row, b: Row) => Number(!!b.expenseOnly) - Number(!!a.expenseOnly)), [data?.inventory, search]);
  return <div className="page veg-page"><RecordRemovalDialog branchId={branchId} target={removalTarget} onClose={()=>setRemovalTarget(null)} onRemoved={async()=>{refreshAfterSave();}}/>
    <section className="panel veg-header"><div><span>SABZAVOT VA SOUS SARFI</span><h2>Sabzavot va sous zaxirasi</h2><p>Xarid va bog‘langan taomlar savdosidan taxminiy qoldiq hisoblanadi. “Tugadi” yoki qoldiqni belgilasangiz, keyingi taxmin aniqlashadi.</p></div><div className="veg-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>{setNewProduct({name:'',unit:'dona',operationId:crypto.randomUUID()});setPurchaseOpen(false);}}>＋ Yangi mahsulot qo‘shish</button><button type="button" onClick={openPurchase}>＋ Xarid kiritish</button><button type="button" className="secondary" onClick={() => setSettingsOpen(!settingsOpen)}>Mahsulotlar va me’yor</button></div></section>
    <div className="veg-actions" role="group" aria-label="Ko‘rinish"><button type="button" className={view==='reserve'?'':'secondary'} onClick={()=>setView('reserve')}>Zaxira va yetish muddati</button><button type="button" className={view==='expenses'?'':'secondary'} onClick={()=>setView('expenses')}>Xarajat hisoboti</button><button type="button" className="secondary" onClick={()=>setRevision(n=>n+1)}>Yangilash</button></div>
    {view === 'expenses' && <div className="veg-toolbar"><div role="group" aria-label="Hisobot davri">{([['day', 'KUNLIK'], ['week', 'HAFTALIK'], ['month', 'OYLIK']] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>)}</div><label>Sana<input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)}/></label><button type="button" className="secondary" onClick={() => setRevision(n => n + 1)}>Yangilash</button></div>}
    {notice && <p role="status" className="veg-notice">{notice}</p>}
    {loading && <p role="status">{data ? 'Yangi hisobot yuklanmoqda… Hozir oldingi natija ko‘rsatilgan.' : 'Hisobot yuklanmoqda…'}</p>}
    {newProduct && <section className="panel veg-form"><h3>Yangi sabzavot yoki sous</h3><fieldset disabled={busy}><label>Mahsulot nomi<input autoFocus maxLength={100} placeholder="Masalan: PIYOZ yoki YANGI SOUS" value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})}/></label><label>Xarid birligi<select value={newProduct.unit} onChange={e=>setNewProduct({...newProduct,unit:e.target.value})}>{[['dona','Dona'],['g','Gramm'],['kg','Kilogramm'],['ml','Millilitr'],['litr','Litr'],['quti','Quti'],['banka','Banka'],['paket','Paket']].map(([u,label])=><option key={u} value={u}>{label}</option>)}</select></label></fieldset><p>Mahsulot shu bo‘limdagi alohida zaxiraga qo‘shiladi. Xarid summasini keyingi qadamda kiritasiz.</p><div className="veg-actions"><button type="button" disabled={busy||!newProduct.name.trim()} onClick={()=>void saveProduct()}>{busy?'Saqlanmoqda…':'Mahsulotni qo‘shish'}</button><button type="button" className="secondary" disabled={busy} onClick={()=>setNewProduct(null)}>Bekor qilish</button></div></section>}
    {purchaseOpen && data && <section className="panel veg-form veg-purchase-form"><h3>Xarid kiritish</h3><p>Faqat mahsulot, miqdor, narx va sanani kiriting. Qarz va to‘lov yetkazib beruvchilar bo‘limida alohida yuritiladi.</p>
      <fieldset disabled={busy} className="veg-purchase-fields">
        <label className="veg-wide">Mahsulot<select value={purchase.inventoryId} onChange={e => { const i = data.inventory.find((i: Row) => i.id === e.target.value); changePurchase({ inventoryId: e.target.value, unit: i?.packageName || i?.unit || 'dona', remainingStatus: 'unknown', remaining: '' }); }}><option value="">Tanlang</option>{data.inventory.filter((i: Row) => isExpenseOnlyInventory(i) && !i.catalogArchived).map((i: Row) => <option value={i.id} key={i.id}>{i.name}</option>)}</select></label>
        <label>Miqdor<input type="number" min="0.001" step="any" placeholder="Masalan: 2" value={purchase.quantity} onChange={e => changePurchase({ quantity: e.target.value })}/></label>
        <label>Birlik<select value={purchase.unit} onChange={e => changePurchase({ unit: e.target.value, remainingStatus: 'unknown', remaining: '' })}>{Array.from(new Set(['dona','g','kg','ml','litr','kalla','quti','banka','paket',purchase.unit])).filter(Boolean).map(u => <option key={u} value={u}>{u === 'g' ? 'Gramm' : u === 'kg' ? 'Kilogramm' : u === 'ml' ? 'Millilitr' : u}</option>)}</select></label>
        <label>Jami narx · ₩<input type="number" min="1" step="1" placeholder="Masalan: 15000" value={purchase.amount} onChange={e => changePurchase({ amount: e.target.value })}/></label>
        <label className="veg-wide">Sana<input type="date" max={seoulCalendarDate()} min={data.startedAt ? seoulCalendarDate(new Date(data.startedAt)) : undefined} value={purchase.date} onChange={e => changePurchase({ date: e.target.value })}/></label>
      </fieldset>
      <details className="veg-purchase-extra"><summary>Qo‘shimcha: vaqt va oldingi qoldiq</summary><fieldset disabled={busy}>
        <label>Xarid vaqti · Seoul<input type="time" value={purchase.time} onChange={e => changePurchase({ time: e.target.value })}/></label>
        <label>Xariddan oldingi qoldiq<select value={purchase.remainingStatus} onChange={e => changePurchase({ remainingStatus: e.target.value, remaining: '' })}><option value="unknown">Bilmayman</option><option value="empty">Oldingisi tugadi</option><option value="known">Qancha qolganini bilaman</option></select></label>
        {purchase.remainingStatus === 'known' && <label>Qolgan miqdor · {purchase.unit}<input type="number" min="0" step="any" value={purchase.remaining} onChange={e => changePurchase({ remaining: e.target.value })}/></label>}
      </fieldset></details>
      {purchaseNotice && <p role="alert" className="veg-alert">{purchaseNotice}</p>}
      <div className="veg-actions"><button type="button" disabled={busy} onClick={() => void savePurchase(similarPurchase)}>{busy ? 'Saqlanmoqda…' : similarPurchase ? 'Bu boshqa xarid — alohida saqlash' : 'Saqlash'}</button><button type="button" className="secondary" disabled={busy} onClick={() => {setPurchaseOpen(false); setSimilarPurchase(false);}}>Yopish</button></div>
    </section>}
    {settingsOpen && data && <section className="panel veg-settings"><h3>Mahsulotlar va me’yor</h3><div className="veg-actions"><label>Me’yor %<input type="number" min="0" max="100" step="0.1" value={norm} onChange={e => setNorm(e.target.value)}/></label><button type="button" disabled={busy || norm === ''} onClick={() => void action({ action: 'norm', normPct: Number(norm) })}>Me’yorni saqlash</button></div><p>Haftalik ulush me’yordan 2 foiz punktdan ko‘proq oshsa, qizil belgi chiqadi.</p>
      <input aria-label="Mahsulotlardan qidirish" placeholder="Mahsulot nomi…" value={search} onChange={e => setSearch(e.target.value)}/><div className="veg-product-settings">{settingsProducts.map((i: Row) => <label key={i.id}><span><strong>{i.name}</strong><small>{i.expenseOnly ? 'Omborsiz (xarajat)' : 'Ombor hisobi'}{i.unitCost > 0 ? ` · tannarx ₩${i.unitCost.toLocaleString()} / ${i.unit}` : ' · tannarx narxi kiritilmagan'}</small></span><input type="checkbox" checked={!!i.expenseOnly} disabled={busy} aria-label={`${i.name}: Omborsiz (xarajat)`} onChange={e => void action({ action: 'configure', inventoryId: i.id, enabled: e.target.checked })}/></label>)}</div><p>Belgi o‘zgargan paytdan keyingi yozuvlarga ishlaydi. Avvalgi ombor tarixi va xaridlar saqlanadi. Belgini olib tashlasangiz, eski qoldiq saqlanadi; yangi haqiqiy qoldiqni ombor sanog‘ida kiriting.</p>
    </section>}
    {!purchaseOpen && !newProduct && view === 'reserve' && data?.reserve && <><PurchaseReservePanel key={branchId} report={data.reserve} counts={data.reserveCounts||[]} onRemove={(kind,id,label)=>setRemovalTarget({kind,id,label})} busy={busy} onAction={action} onPurchase={openPurchase}/><section className="panel"><p>{data.telegramConnected?'Telegram ulangan.':'Telegram hali ulanmagan.'} {data.settings?.schedulerSeenAt?`Avtomatik tekshiruvning oxirgi qaydi: ${data.settings.schedulerSeenAt}.`:'Sayt yopiq paytdagi tekshiruv hali tasdiqlanmagan.'}</p><button type="button" className="secondary" onClick={onIntegrations}>Avtomatik tekshiruv / Telegram ulanishi</button></section></>}
    {!purchaseOpen && !newProduct && view === 'expenses' && r && <>
      <p className="veg-period-caption">{r.start} — {r.end} · Asia/Seoul · hafta dushanbadan boshlanadi</p>
      {r.partial && <p className="veg-notice">Hisob shu davr ichida boshlangan. Faqat yangi qoidadan keyingi xaridlar kiritilgan; eski xaridlar qayta hisoblanmagan.</p>}
      <div className="veg-metrics"><article><span>Sarf summasi</span><strong>{won(r.expense)}</strong><small>Davrdagi xaridlar</small></article><article><span>Savdo summasi</span><strong>{won(r.revenue)}</strong><small>Barcha faol savdolar</small></article><article><span>Sarf / savdo</span><strong>{pct(r.ratio)}</strong><small>Me’yor: {r.normPct}%</small></article><article><span>Oldingi davrga nisbatan</span><strong>{r.differencePoints === null ? '—' : `${r.differencePoints >= 0 ? '+' : ''}${r.differencePoints.toFixed(2)} punkt`}</strong><small>{r.differencePoints === null ? 'Solishtirish uchun ma’lumot yetarli emas' : `${r.previous.start} — ${r.previous.end}`}</small></article></div>
      {r.alert && <p role="alert" className="veg-alert">● Haftalik sarf / savdo {pct(r.weekly.ratio)}. Chegara: {r.normPct + 2}%. Eng katta xaridlarni tekshiring.</p>}
      <section className="panel"><div className="veg-section-head"><h3>Mahsulotlar bo‘yicha</h3><span>{r.products.length} mahsulot</span></div><div className="veg-table-scroll"><table><thead><tr><th>Mahsulot</th><th>Xarid miqdori</th><th>Summa (₩)</th><th>Sarfdagi ulushi</th></tr></thead><tbody>{r.products.map((p: Row) => <tr key={p.inventoryId}><th>{p.name}</th><td>{quantities(p.quantities)}</td><td>{won(p.amount)}</td><td>{p.share.toFixed(1)}%</td></tr>)}</tbody></table></div>{!r.products.length && <p className="veg-empty">Bu davrda omborsiz xarid yo‘q.</p>}</section>
      <section className="panel"><h3>Sarf / savdo % · oxirgi {r.period === 'day' ? '30 kun' : r.period === 'week' ? '12 hafta' : '12 oy'}</h3><RatioChart points={r.history} norm={r.normPct}/></section>
      <section className="panel"><h3>Xaridlar ro‘yxati</h3><div className="veg-table-scroll"><table><thead><tr><th>Sana</th><th>Mahsulot</th><th>Miqdor</th><th>Summa</th><th>Yetkazib beruvchi</th><th>Kim kiritgan</th><th>Amal</th></tr></thead><tbody>{r.purchases.map((p: Row) => <tr key={p.id}><td>{p.date}</td><th>{p.name}</th><td>{p.quantity.toLocaleString()} {p.unit}</td><td>{won(p.amount)}</td><td>{p.supplierName}</td><td>{p.recordedBy}</td><td><button type="button" className="secondary remove-record" onClick={()=>setRemovalTarget({kind:"vegetable",id:p.id,label:`${p.name} · ${won(p.amount)}`})}>Olib tashlash</button></td></tr>)}</tbody></table></div>{!r.purchases.length && <p className="veg-empty">Xarid kiritilgach shu yerda ko‘rinadi.</p>}</section>
      <section className="panel veg-telegram"><h3>Har kuni · 09:00 · Telegram</h3><p>{data.telegramConnected ? 'Telegram qabul qiluvchi ulangan.' : 'Hisobot uchun rahbar Telegram botini ulang.'} 3, 7, 15 va 30 kunlik savdo hamda xarid tahlili. Sayt yopiq paytdagi yuborish uchun Google Sheets avtomatik yangilashi ishlayotgan bo‘lishi kerak.</p><p>{data.settings.schedulerSeenAt ? `Oxirgi avtomatik tekshiruv: ${data.settings.schedulerSeenAt} (Seoul).` : 'Avtomatik jadval hali tekshirilmagan. Google Sheets kodini o‘rnating va HALO_SETUP’ni ishga tushiring.'}</p><p>Google taymeri ishga tushgan birinchi tekshiruvda, 09:00 dan boshlab yuboriladi. Xizmat kechiksa xabar ham kechikishi mumkin.</p><button type="button" className="secondary" onClick={onIntegrations}>Google Sheets ulanishini ochish</button></section>
    </>}
  </div>;
}
