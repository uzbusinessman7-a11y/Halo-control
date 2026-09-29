"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { inventoryCountVariance, type InventoryCount } from './lib/inventory-accounting';
type Item = { supplierId?: string; unitCost?: number; id: string; name: string; unit: string; stock: number; packageName: string; unitsPerPackage: number; expenseOnly: boolean };
type Payload = { suppliers: { id: string; name: string }[]; inventory: Item[]; counts: InventoryCount[]; reports: ReturnType<typeof inventoryCountVariance>[]; owner: boolean; };
const quantity = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 3 });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export default function InventoryAccountingPanel({ branchId, onSaved, onBefore, workerMode = false, onReceive }: { onReceive?: () => void; workerMode?: boolean; branchId: string; onSaved?: () => void | Promise<void>; onBefore?: () => void | Promise<void> }) {
  const [data, setData] = useState<Payload | null>(null);
  const [tab, setTab] = useState<'exact' | 'report' | 'settings'>('exact');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [supplier, setSupplier] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [reportItem, setReportItem] = useState('');
  const [startId, setStartId] = useState('');
  const [endId, setEndId] = useState('');
  const operation = useRef('');
  const load = useCallback(async () => {
    setLoading(true);
    try {
    const response = await fetch(`/api/inventory-accounting?branch=${encodeURIComponent(branchId)}${workerMode ? '&portal=worker' : ''}`, { cache: 'no-store' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Ombor ochilmadi.');
    setData(result);
    } finally { setLoading(false); }
  }, [branchId, workerMode]);
  useEffect(() => { setValues({}); setSelectedId(''); operation.current = ''; void load().catch(e => setNotice(e.message)); }, [load]);
  const post = async (body: Record<string, unknown>) => {
    await onBefore?.();
    const response = await fetch(`/api/inventory-accounting?branch=${encodeURIComponent(branchId)}${workerMode ? '&portal=worker' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Saqlanmadi.');
    return result;
  };
  const saveCount = async () => {
    if (busy) return;
    const entries = Object.entries(values).filter(([, value]) => value.trim() !== '');
    if (!entries.length) { setNotice('Sanagan mahsulotlaringizni belgilang. Bo‘sh qator o‘zgarmaydi.'); return; }
    setBusy(true); setNotice('Sanoq saqlanmoqda…');
    operation.current ||= crypto.randomUUID();
    let saved = false;
    try {
      await post({ action: 'count', operationId: operation.current, date: today(), counts: entries.map(([inventoryId, value]) => ({ inventoryId, actualStock: Number(value) })) });
      saved = true;
      setValues({}); operation.current = ''; await load(); await onSaved?.();
      setNotice('✓ Sanoq, sana va sanagan shaxs saqlandi.');
    } catch (e) { setNotice(saved ? '✓ Sanoq saqlandi. Ekranni yangilash uchun Yangilash tugmasini bosing.' : (e as Error).message); } finally { setBusy(false); }
  };
  const configure = async () => {
    if (!editing || busy) return;
    setBusy(true);
    try { await post({ action: 'configure', inventoryId: editing.id, expenseOnly: editing.expenseOnly, packageName: editing.packageName, unitsPerPackage: editing.unitsPerPackage }); setValues(current => { const next = {...current}; delete next[editing.id]; return next; }); operation.current = ''; setSelectedId(editing.id); setSearch(''); setTab('settings'); setEditing(null); await load(); await onSaved?.(); setNotice('✓ Hisoblash usuli saqlandi. Eski tarix o‘zgarmadi.'); }
    catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };
  const switchTab = (next: typeof tab) => { setTab(next); setSearch(''); setNotice(''); };
  const setCount = (item: Item, value: string) => {
    operation.current = '';
    setValues(current => ({ ...current, [item.id]: value }));
  };
  const openSettings = (item?: Item) => {
    setEditing(item ? { ...item } : null);
    setSearch(''); setSupplier(''); setTab('settings'); setNotice('');
  };
  const items = (data?.inventory || []).filter(i => (!supplier || i.supplierId === supplier) && i.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  const visible = items.filter(i => tab !== 'exact' || !i.expenseOnly);
  const selected = visible.find(item => item.id === selectedId);
  const entered = (data?.inventory || []).filter(i => !i.expenseOnly && values[i.id]?.trim() !== '' && values[i.id] !== undefined);
  const systemValue = entered.reduce((sum,i) => sum + i.stock * Number(i.unitCost || 0), 0);
  const actualValue = entered.reduce((sum,i) => sum + Number(values[i.id]) * Number(i.unitCost || 0), 0);
  const counts = (data?.counts || []).filter(c => c.inventoryId === reportItem).sort((a, b) => a.countedAt.localeCompare(b.countedAt));
  const start = counts.find(c => c.id === startId), end = counts.find(c => c.id === endId);
  const reports = start && end && start.countedAt < end.countedAt ? [inventoryCountVariance(start, end)] : (data?.reports || []).filter(r => !reportItem || r.end.inventoryId === reportItem);
  return <section id="inventory-accounting" className="inventory-accounting panel" aria-label="Hisob usuli va sanoq">
    <div className="panel-head"><div><h3>Omborni boshqarish</h3></div><button type="button" disabled={busy || loading} onClick={() => void load().catch(e => setNotice(e.message))}>Yangilash</button></div>
    <fieldset disabled={busy} className="accounting-fieldset">
      <nav className="accounting-main-actions" aria-label="Omborda nima qilmoqchisiz?">
        {onReceive && <button type="button" onClick={onReceive}><strong>Mahsulot keldi</strong><small>Kelgan miqdorni qo‘shish</small></button>}
        <button type="button" className={tab === 'exact' ? 'active' : ''} onClick={() => switchTab('exact')}><strong>Qancha qoldi?</strong><small>Hozirgi qoldiqni sanash</small></button>
        <button type="button" className={tab === 'report' ? 'active' : ''} onClick={() => switchTab('report')}><strong>Sanoq natijasi</strong><small>Ortiqcha sarfni ko‘rish</small></button>
        {data?.owner && <button type="button" className={tab === 'settings' ? 'active' : ''} onClick={() => openSettings()}><strong>Hisoblash usuli</strong><small>Oddiy yoki Omborsiz (xarajat)</small></button>}
      </nav>
      {!data ? <p>{loading ? 'Mahsulotlar ochilmoqda…' : 'Mahsulotlar ochilmadi. Yangilash tugmasini bosing.'}</p> : <>
        {(tab === 'exact') && <>
          <p className="accounting-instruction">Mahsulotni tanlang, <b>hozir qancha qolganini</b> belgilang va saqlang.</p>
          <div className="accounting-pickers">
            <label>Qaysi mahsulot?<select value={selected?.id || ''} onChange={e => { setSelectedId(e.target.value); setTab('exact'); }}><option value="">Mahsulotni tanlang</option>{visible.map(item => <option key={item.id} value={item.id}>{item.name}{values[item.id]?.trim() ? ' · belgilandi' : ''}</option>)}</select></label>
          </div>
          {data.owner && <details className="accounting-extra"><summary>{supplier ? `Yetkazib beruvchi: ${data.suppliers.find(s => s.id === supplier)?.name || "Tanlangan"}` : "Yetkazib beruvchi bo‘yicha tanlash"}</summary><label>Kimdan olingan mahsulotlar?<select value={supplier} onChange={e=>{setSupplier(e.target.value);setSelectedId('');}}><option value="">Barcha yetkazib beruvchilar</option>{(data.suppliers || []).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label></details>}
          {selected && (() => {
            const item = selected;
            const latest = data.counts.filter(c => c.inventoryId === item.id).sort((a,b) => b.countedAt.localeCompare(a.countedAt))[0];
            const value = values[item.id] ?? '';
            return <div className="accounting-count-list accounting-single-count"><article>
              <div className="accounting-item-title"><strong>{item.name}</strong></div>
              <p>Tizimdagi qoldiq: <b>{quantity(item.stock)} {item.unit}</b></p>
              <label>Hozir sanagan yoki tortgan miqdor ({item.unit})<input aria-label={`${item.name} haqiqiy qoldiq`} type="number" inputMode="decimal" min="0" step="any" placeholder="Miqdorni yozing" value={value} onChange={e => setCount(item,e.target.value)}/><small>{item.unit === 'g' ? 'Masalan, 2 kg bo‘lsa — 2000 yozing.' : `Miqdorni ${item.unit} birligida yozing.`}</small></label>
              {latest && <small>Oxirgi sanoq: {latest.date} · {latest.countedBy}</small>}
              {data.owner && <button type="button" className="accounting-settings-link" onClick={() => openSettings(item)}>Bu mahsulotni sozlash</button>}
            </article></div>;
          })()}
          {!visible.length && <p>Mahsulot topilmadi. Yetkazib beruvchi filtrini tekshiring yoki yangi mahsulot qo‘shing.</p>}
          {entered.length > 0 && <div className="accounting-review"><b>Saqlashga tayyor: {entered.length} mahsulot</b>{entered.map(item => <div key={item.id}><span>{item.name}</span><strong>{`${quantity(Number(values[item.id]))} ${item.unit}`}</strong><button type="button" aria-label={`${item.name} sanog‘ini bekor qilish`} onClick={() => setCount(item,'')}>×</button></div>)}</div>}
          <button className="primary accounting-save" type="button" disabled={busy || !entered.length} onClick={() => void saveCount()}>{busy ? 'Saqlanmoqda…' : 'Qoldiqni saqlash'}</button>
          <p className="accounting-note">Faqat siz belgilagan mahsulot saqlanadi. 0 yozilsa, qoldiq tugagan deb saqlanadi. Omborsiz mahsulotlar sanalmaydi.</p>
          {data.owner && entered.length > 0 && <details className="accounting-extra"><summary>Puldagi farqni ko‘rish</summary><dl><div><dt>Tizimdagi qiymat</dt><dd>₩{quantity(systemValue)}</dd></div><div><dt>Haqiqiy qiymat</dt><dd>₩{quantity(actualValue)}</dd></div><div><dt>Qiymat farqi</dt><dd>₩{quantity(actualValue-systemValue)}</dd></div></dl></details>}
        </>}
        {tab === 'settings' && data.owner && <>
          <h4>Mahsulotni bir marta sozlash</h4>
          {!editing && <><label className="accounting-search">Mahsulotni topish<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Mahsulot nomi" /></label><div className="accounting-settings-list">{visible.map(item => <div key={item.id}><span><strong>{item.name}</strong><small>{item.expenseOnly ? 'Omborsiz (xarajat)' : 'Oddiy — sotuvda ayiriladi'}</small></span><button type="button" onClick={() => setEditing({...item})}>Sozlash</button></div>)}</div></>}
          {editing && <div className="accounting-edit" role="group" aria-label={`${editing.name} hisob sozlamalari`}>
            <h4>{editing.name}</h4>
            <label>Qanday hisoblanadi?<select value={editing.expenseOnly ? 'expense' : 'stock'} onChange={e=>setEditing({...editing,expenseOnly:e.target.value === 'expense'})}><option value="stock">Oddiy — sotuvda ayiriladi</option><option value="expense">Omborsiz (xarajat)</option></select></label>
            <p>{editing.expenseOnly ? 'Sotuvda qoldiq kamaymaydi. Xarid Sabzavot va sous xarajatiga yoziladi. Retsept tannarxi saqlanadi.' : 'Sotilganda retseptda ko‘rsatilgan miqdor ombordan ayiriladi.'}</p>
            <label>Qanday olib kelasiz?<input list="purchase-unit-options" value={editing.packageName} onChange={e=>setEditing({...editing,packageName:e.target.value})}/><datalist id="purchase-unit-options"><option value="dona"/><option value="kalla"/><option value="quti"/><option value="qop"/><option value="pachka"/></datalist></label>
            <label>1 {editing.packageName || 'birlik'} ichida necha {editing.unit}?<input type="number" min="0" step="any" placeholder={editing.unit === 'g' ? 'Masalan: 1500' : 'Miqdor'} value={editing.unitsPerPackage || ''} onChange={e=>setEditing({...editing,unitsPerPackage:Number(e.target.value)})}/></label>
            <small>{editing.unit === 'g' ? 'Masalan, bitta kalla o‘rtacha 1,5 kg bo‘lsa — 1500 yozing.' : `Bitta xarid birligidagi miqdorni ${editing.unit} bilan yozing.`}</small>
            <button type="button" disabled={busy || editing.unitsPerPackage <= 0} onClick={()=>void configure()}>Sozlamani saqlash</button><button type="button" onClick={()=>setEditing(null)}>Boshqa mahsulot</button>
          </div>}
        </>}
        {tab === 'report' && <>
          <h4>Sanoq natijasi</h4><p>Mahsulot qancha ishlatilgani va retsept hisobidan qanchaga farq qilganini ko‘rasiz.</p>
          <div className="accounting-report-filters"><label>Qaysi mahsulot?<select value={reportItem} onChange={e=>{setReportItem(e.target.value);setStartId('');setEndId('');}}><option value="">Barcha mahsulotlar</option>{data.inventory.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label></div>
          {reportItem && <details className="accounting-extra"><summary>Ikki sanoq sanasini tanlash</summary><div className="accounting-report-filters"><label>Birinchi sanoq<select value={startId} onChange={e=>setStartId(e.target.value)}><option value="">Tanlang</option>{counts.map(c=><option key={c.id} value={c.id}>{new Date(c.countedAt).toLocaleString('uz-UZ',{timeZone:'Asia/Seoul'})} · {c.countedBy}</option>)}</select></label><label>Keyingi sanoq<select value={endId} onChange={e=>setEndId(e.target.value)}><option value="">Tanlang</option>{counts.filter(c=>!start || c.countedAt>start.countedAt).map(c=><option key={c.id} value={c.id}>{new Date(c.countedAt).toLocaleString('uz-UZ',{timeZone:'Asia/Seoul'})} · {c.countedBy}</option>)}</select></label></div></details>}
          {!reports.length && <div className="accounting-empty-result"><b>Hali solishtirish uchun sanoq yetarli emas.</b><p>Bugun qoldiqni saqlang. Keyingi safar yana sanasangiz, natija shu yerda chiqadi.</p><button type="button" onClick={() => switchTab('exact')}>Qoldiqni sanash</button></div>}
          <div className="accounting-variance-list">{reports.map(r => <article key={`${r.start.id}:${r.end.id}`} className={r.invalid ? 'alert' : ''}>
            <div><h4>{r.end.name}</h4><small>{r.start.date} → {r.end.date} · {r.end.countedBy}</small><b>{r.invalid ? 'Kirim va sanoqni tekshiring' : 'Sanoq bo‘yicha farq'}</b></div>
            {!r.invalid && <p>{r.percent === null ? 'Savdo bo‘yicha kutilgan sarf 0. Foizni hisoblab bo‘lmaydi.' : `Retsept hisobidan ${Math.abs(r.percent).toFixed(1)}% ${r.percent >= 0 ? 'ko‘proq' : 'kamroq'} ishlatilgan.`}</p>}
            <dl><div><dt>Ishlatilgan</dt><dd>{quantity(r.actual)} {r.end.unit}</dd></div><div><dt>Retsept bo‘yicha</dt><dd>{quantity(r.theoretical)} {r.end.unit}</dd></div><div><dt>Farqi</dt><dd>{quantity(r.difference)} {r.end.unit}</dd></div></dl>
            <details className="accounting-extra"><summary>Hisob qanday chiqdi?</summary><p>Oldingi qoldiq {quantity(r.start.actualStock)} + kelgan {quantity(r.receipts)} − hozirgi qoldiq {quantity(r.end.actualStock)} = ishlatilgan {quantity(r.actual)} {r.end.unit}.</p><small>Farq foizi retsept bo‘yicha kutilgan sarfga nisbatan hisoblanadi.</small></details>
          </article>)}</div>
        </>}
        <div className="accounting-secondary-actions">{data.owner && tab !== 'settings' && <button type="button" onClick={() => openSettings()}>Mahsulot sozlamalari</button>}</div>
      </>}
    </fieldset>
    {notice && <p role="status" className={notice.startsWith('✓')?'positive':'accounting-note'}>{notice}</p>}
  </section>;
}
