import { useMemo, useState } from 'react';
import { salesTrendReport, trendChangeText } from './lib/business-trends';
import { seoulCalendarDate, previousSeoulDate } from './lib/business-time';

type Props = { state: Record<string, any>; branchName?: string };
const won = (value: number) => `${Math.round(value).toLocaleString('en-US')}₩`;

export default function BusinessTrendsPanel({ state, branchName }: Props) {
  const latest = previousSeoulDate(seoulCalendarDate());
  const [selectedDate, setSelectedDate] = useState('');
  const endDate = selectedDate || latest;
  const report = useMemo(() => salesTrendReport(state, endDate), [state, endDate]);
  const [days, setDays] = useState(7);
  const selected = report.windows.find(w => w.days === days)!;
  const max = Math.max(1, ...report.history.map(d => d.revenue));
  const points = report.history.map((d, i) => `${i * 20},${110 - d.revenue / max * 100}`).join(' ');
  return <section className="panel" aria-label="Savdo va sarf tahlili">
    <div className="section-head"><div><p className="eyebrow">SAVDO VA SARF TAHLILI</p><h2>Savdo qanday o‘zgaryapti?</h2><p>{branchName ? `${branchName} · ` : ''}Seoul vaqti. Tugagan kunlar teng davr bilan solishtiriladi.</p></div><label>Oxirgi sana<input type="date" value={endDate} max={latest} onChange={e => { if (e.target.value && e.target.value <= latest) setSelectedDate(e.target.value); }} /></label></div>
    <div className="sales-channel-cards">{report.periods.map(p => <article key={p.kind}><span>{p.label}</span><strong>{won(p.current.revenue)}</strong><span>{trendChangeText(p.changePct, p.previous.revenue)}</span><small>{p.current.start} — {p.current.end}<br />Oldingi: {won(p.previous.revenue)}</small></article>)}</div>
    <div className="tab-buttons" role="group" aria-label="Tahlil davri" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '18px 0' }}>{report.windows.map(w => <button key={w.days} type="button" className={days === w.days ? 'primary' : 'secondary'} aria-pressed={days === w.days} onClick={() => setDays(w.days)}>{w.days} kun</button>)}</div>
    <p>{selected.current.start} — {selected.current.end} · oldingi {days} kun: {selected.previous.start} — {selected.previous.end}</p>
    <div className="sales-channel-cards">
      <article><span>Jami savdo</span><strong>{won(selected.current.revenue)}</strong><small>{trendChangeText(selected.changePct, selected.previous.revenue)}</small></article>
      <article><span>Sabzavot va sous xaridi</span><strong>{won(selected.current.vegetableSpend)}</strong><small>Oldingi: {won(selected.previous.vegetableSpend)}</small></article>
      <article><span>Xarid / savdo</span><strong>{selected.current.vegetableShare === null ? '—' : `${selected.current.vegetableShare.toFixed(2)}%`}</strong><small>{selected.vegetableShareChangePoints === null ? 'Solishtirish uchun ma’lumot yetarli emas' : `${selected.vegetableShareChangePoints >= 0 ? '+' : ''}${selected.vegetableShareChangePoints.toFixed(2)} foiz punkt`}</small></article>
    </div>
    <p>Naqd: <b>{won(selected.current.cash)}</b> · POS: <b>{won(selected.current.pos)}</b> · Delivery: <b>{won(selected.current.delivery)}</b>{selected.current.bank !== 0 && <> · Bank: <b>{won(selected.current.bank)}</b></>}. Har savdo bir marta, komissiyadan oldingi summada hisoblanadi.</p>
    <details><summary>Oxirgi 30 kunning grafigi va summalari</summary><svg role="img" aria-label="Oxirgi 30 to‘liq kun savdosi" viewBox="0 0 580 120" style={{ width: '100%', maxHeight: 180, marginTop: 16 }}><line x1="0" y1="110" x2="580" y2="110" stroke="currentColor" opacity=".2"/><polyline points={points} fill="none" stroke="#e8bf62" strokeWidth="3"/></svg><div className="table-wrap"><table><thead><tr><th>Sana</th><th>Naqd</th><th>POS</th><th>Delivery</th><th>Bank</th><th>Jami</th></tr></thead><tbody>{report.history.slice().reverse().map(d => <tr key={d.date}><td>{d.date}</td><td>{won(d.cash)}</td><td>{won(d.pos)}</td><td>{won(d.delivery)}</td><td>{won(d.bank)}</td><td>{won(d.revenue)}</td></tr>)}</tbody></table></div></details>
    <p className="field-help">Sabzavot va sous sarfi bu yerda xarid summasidir. Haqiqiy tugash va taxminiy qoldiq alohida zaxira bo‘limida kuzatiladi. Nol savdo ma’lumot kiritilmaganini ham anglatishi mumkin.{selected.vegetablePartial && ' Sabzavot hisobi tanlangan davr ichida boshlangan.'}</p>
  </section>;
}
