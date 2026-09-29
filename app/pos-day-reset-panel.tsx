"use client";
import { useRef, useState } from 'react';
import { seoulCalendarDate } from './lib/business-time';
import type { PosDayResetPreview } from './lib/pos-day-reset';
import './pos-day-reset.css';

const won = (n: number) => `${Math.round(n).toLocaleString('en-US')} ₩`;
export default function PosDayResetPanel({ request, onBusy }: {
  request: (body: Record<string, unknown>) => Promise<any>;
  onBusy: (busy: boolean) => void;
}) {
  const [date, setDate] = useState(seoulCalendarDate());
  const [preview, setPreview] = useState<PosDayResetPreview | null>(null);
  const [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false), operationId = useRef('');
  const run = async (cancel: boolean) => {
    if (lock.current || !date || (cancel && !preview?.count)) return;
    if (cancel && !window.confirm(`${date}: ${preview!.count} ta POS import yozuvi (${won(preview!.revenue)}) bekor qilinsinmi?\n\nOmbor sarfi qaytariladi. Tushum, tannarx, ushlanmalar, foyda va savdo bonusi qayta hisoblanadi. Yozuvlar arxivda saqlanadi.${preview!.reopenedDates.length ? `\n${preview!.reopenedDates.length} ta kun yakuni qayta tekshirish uchun ochiladi.` : ''}\n\nKeyin to‘g‘ri Excel faylini yuklang.`)) return;
    lock.current = true; setBusy(true); onBusy(true); setNotice('');
    try {
      if (!cancel) {
        setPreview(null);
        const result = await request({ action: 'preview', date });
        setPreview(result); operationId.current = crypto.randomUUID();
        if (!result.count) setNotice('Bu sanada Excel yoki suratdan kiritilgan POS savdo yo‘q.');
      } else {
        const result = await request({ action: 'cancel', date, token: preview!.token, operationId: operationId.current });
        setPreview(null); operationId.current = '';
        setNotice(`✓ ${date}: ${result.count} ta yozuv (${won(result.revenue)}) bekor qilindi. Ombor va hisoblar yangilandi. Endi pastdagi “Excel / CSV” orqali to‘g‘ri faylni yuklang.${result.reopenedDates?.length ? ' Importdan keyin Moliya bo‘limida ochilgan kun yakunlarini qayta tekshiring.' : ''}`);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Ulanish uzildi. Shu amalni qayta bosing.');
    } finally { lock.current = false; setBusy(false); onBusy(false); }
  };
  return <section className="pos-day-reset" aria-labelledby="pos-day-reset-title">
    <div><span>NOTO‘G‘RI IMPORTNI TUZATISH</span><h3 id="pos-day-reset-title">Kun bo‘yicha POS importini bekor qilish</h3>
      <p>Excel yoki suratdan kiritilgan savdolar uchun. Qo‘lda kiritilgan, naqd, bank va delivery savdolari saqlanadi.</p></div>
    <div className="pos-reset-controls"><label>Sana<input type="date" value={date} max={seoulCalendarDate()} disabled={busy} onChange={e => { setDate(e.target.value); setPreview(null); setNotice(''); operationId.current = ''; }} /></label>
      <button type="button" disabled={busy || !date} onClick={() => void run(false)}>{busy ? 'Tekshirilmoqda…' : 'Tekshirish'}</button></div>
    {preview && preview.count > 0 && <div className="pos-reset-preview">
      <strong>{preview.date} · {preview.count} ta yozuv · {preview.quantity} ta mahsulot · {won(preview.revenue)}</strong>
      <p>Hisobdan chiqariladi: tannarx {won(preview.effects.cost)}, karta komissiyasi {won(preview.effects.cardCommission)}, soliq zaxirasi {won(preview.effects.tax)}.</p>
      <p>Shu kun savdo bonusi: {won(preview.effects.bonusBefore)} → {won(preview.effects.bonusAfter)}.</p>
      <details><summary>Omborga qaytadigan mahsulotlar: {preview.stocks.length} tur</summary>
        {preview.stocks.length ? <ul>{preview.stocks.map(s => <li key={s.inventoryId}>{s.name}: +{s.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 })} {s.unit}</li>)}</ul> : <p>Bu savdolarda ombordan miqdor ayirilmagan.</p>}</details>
      {!!preview.reopenedDates.length && <p className="pos-reset-warning">Kun yakunlari qayta tekshirishga ochiladi: {preview.reopenedDates.join(', ')}. Avvalgi yakunlar arxivda qoladi.</p>}
      <button type="button" className="pos-reset-confirm" disabled={busy} onClick={() => void run(true)}>{busy ? 'Bajarilmoqda…' : 'Shu kun importini bekor qilish'}</button>
    </div>}
    {notice && <p className={notice.startsWith('✓') ? 'pos-reset-success' : 'pos-reset-warning'} role="status">{notice}</p>}
  </section>;
}
