"use client";
import { useRef, useState } from 'react';
import { supplierCancellationBlock } from './lib/supplier-cancellation';

const won = (n: number) => `₩${n.toLocaleString('en-US')}`;
export default function SupplierCancellationPanel({ transaction, supplier, state, busy, onConfirm }: {
  transaction: Record<string, any>; supplier: Record<string, any>; state: Record<string, any>; busy: boolean;
  onConfirm: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [opened, setOpened] = useState(false);
  const [reason, setReason] = useState('Takroriy yozuv kiritilgan');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const lock = useRef(false);
  const snapshot = useRef<{ transaction: Record<string, any>; balance: number; operationId: string } | null>(null);
  const blocked = supplierCancellationBlock(state, transaction);
  const saved = snapshot.current;
  const amount = Number(saved?.transaction.amount ?? transaction.amount);
  const before = Number(saved?.balance ?? supplier.balance);
  const after = before + (transaction.type === 'purchase' ? -amount : amount);
  const balanceText = (n: number) => n < 0 ? `${won(-n)} avans` : `${won(n)} qarz`;
  if (blocked) return <p className="form-notice">{blocked}</p>;
  if (!opened) return <button type="button" className="archive-delete" disabled={busy} onClick={() => {
    snapshot.current = { transaction: structuredClone(transaction), balance: supplier.balance, operationId: crypto.randomUUID() };
    setOpened(true); setError('');
  }}>{transaction.type === 'purchase' ? 'Takroriy / xato qarzni olib tashlash' : 'Xato to‘lovni bekor qilish'}</button>;
  const submit = async () => {
    if (lock.current || busy || !snapshot.current) return;
    lock.current = true; setSending(true); setError('');
    try { await onConfirm({ action: 'cancelTransaction', id: transaction.id, operationId: snapshot.current.operationId,
      expectedTransaction: snapshot.current.transaction, expectedBalance: snapshot.current.balance, reason: reason.trim() }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Bekor qilinmadi. Qayta urinib ko‘ring.'); }
    finally { lock.current = false; setSending(false); }
  };
  return <section className="supplier-cancellation" aria-label="Yozuvni bekor qilish">
    <h4>{supplier.name} · {won(amount)}</h4>
    <p>{transaction.date} · {transaction.note || (transaction.type === 'purchase' ? 'Mahsulot olindi' : 'To‘lov')}</p>
    <p>Hozir: <b>{balanceText(before)}</b><br/>Bekor qilingandan keyin: <b>{balanceText(after)}</b></p>
    <p>{transaction.type === 'purchase' ? 'Faqat tanlangan qarz yozuvi hisobdan chiqadi. Ombordagi mahsulotlar va to‘lovlar saqlanadi.' : 'Tanlangan to‘lov va unga bog‘langan pul chiqimi bekor qilinadi; qarz qayta oshadi.'} Yozuv “Bekor qilinganlar” tarixida qoladi.</p>
    <label>Sabab<input maxLength={300} value={reason} onChange={e => setReason(e.target.value)} disabled={sending} /></label>
    {error && <p role="alert" className="form-notice">{error}</p>}
    <div className="supplier-cancellation-actions"><button type="button" className="danger" disabled={busy || sending || reason.trim().length < 3} onClick={() => void submit()}>{sending ? 'Bekor qilinmoqda…' : `${won(amount)} yozuvni bekor qilish`}</button><button type="button" className="secondary" disabled={sending} onClick={() => { setOpened(false); snapshot.current = null; }}>Ortga</button></div>
  </section>;
}
