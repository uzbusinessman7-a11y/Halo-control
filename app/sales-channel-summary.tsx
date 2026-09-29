import { useMemo } from "react";
import { dateRangeLabel, type DateRange } from "./lib/date-range";
import { summarizeSalesChannels, type SalesSummaryState } from "./lib/sales-bonus";

type Props = { state: SalesSummaryState; range: DateRange; onDateChange?: (date: string) => void };
const won = (value: number) => `${value.toLocaleString("en-US")}₩`;

export default function SalesChannelSummary({ state, range, onDateChange }: Props) {
  const { days, totals } = useMemo(() => summarizeSalesChannels(state, range), [state, range]);
  const oneDay = range.start === range.end && !!range.start;
  return <section className="sales-channel-overview" aria-label="Barcha savdo va kunlik bonus">
    <div className="sales-channel-overview-head"><div><h2>Barcha savdo va xodim bonusi</h2><p>{dateRangeLabel(range)}</p></div>{onDateChange && <label>Sana<input type="date" aria-label="Savdo va bonus sanasi" value={range.start} onChange={(event) => { if (event.target.value) onDateChange(event.target.value); }} /></label>}</div>
    <div className="sales-channel-cards">
      <article><span>Naqd pul</span><strong>{won(totals.cash)}</strong></article>
      <article><span>POS / karta</span><strong>{won(totals.pos)}</strong></article>
      <article><span>Yetkazib berish</span><strong>{won(totals.delivery)}</strong></article>
      {totals.bank !== 0 && <article><span>Bank o‘tkazmasi</span><strong>{won(totals.bank)}</strong></article>}
      <article className="total"><span>Jami savdo</span><strong>{won(totals.total)}</strong></article>
    </div>
    <div className="sales-bonus-result"><div><span>{oneDay ? "Kunlik savdo bonusi" : "Kunlik bonuslar jami"}</span><strong>{won(totals.bonus)}</strong></div><p>Har kuni <b>800 000₩ dan oshgan qism × 10%</b>. {oneDay && <>Oshgan qism: <b>{won(totals.excess)}</b>.</>} Savdo komissiya va xarajatlar ayrilishidan oldin olinadi.</p></div>
    <p className="sales-bonus-help">Bir yozuv faqat bitta savdo turida hisoblanadi. Bu bonus ko‘rsatkichi maoshga avtomatik yozilmaydi. Bonusni maoshga yozish: <a href="/?tab=control#payroll-control">Nazorat markazi → Bonus / ushlanma</a>.</p>
    {!oneDay && <details className="sales-bonus-days"><summary>Kunma-kun savdo va bonus ({days.length} kun)</summary><div className="pos-reconciliation-table"><table><thead><tr><th>Sana</th><th>Naqd</th><th>POS</th><th>Delivery</th>{totals.bank !== 0 && <th>Bank</th>}<th>Jami savdo</th><th>Bonus</th></tr></thead><tbody>{days.map((day) => <tr key={day.date}><td>{day.date}</td><td>{won(day.cash)}</td><td>{won(day.pos)}</td><td>{won(day.delivery)}</td>{totals.bank !== 0 && <td>{won(day.bank)}</td>}<td>{won(day.total)}</td><td>{won(day.bonus)}</td></tr>)}</tbody></table></div></details>}
  </section>;
}
