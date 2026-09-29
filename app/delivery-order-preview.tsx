import { type DeliveryFeeBreakdown, type DeliveryManualFees, type DeliveryFeeKey } from "./lib/delivery-sales";

export default function DeliveryOrderPreview({ inputs, fees, revenue, cost, valid, historical, onSettings, won }: {
  inputs: DeliveryManualFees; fees: DeliveryFeeBreakdown; revenue: number; cost: number;
  valid: boolean; historical: boolean; onSettings?: () => void; won: (value: number) => string;
}) {
  const settlement = revenue - fees.total;
  const contribution = settlement - cost;
  const margin = revenue > 0 ? contribution / revenue * 100 : 0;
  const rows: { key: DeliveryFeeKey; label: string; always?: boolean }[] = [
    { key: "brokerage", label: "Ushlanma", always: true },
    { key: "delivery", label: "Yetkazib berish", always: true },
    { key: "instantDiscount", label: "Chegirma", always: true },
    { key: "payment", label: "To‘lov komissiyasi" },
    { key: "vat", label: "Xizmat QQSi" },
    { key: "coupon", label: "Kupon" },
    { key: "advertising", label: "Reklama" },
  ];
  return <>
    <section className="delivery-order-adjustments" aria-label="Delivery buyurtmasi ushlanmalari">
      <div className="delivery-adjustment-heading"><div><h4>{historical ? "Saqlangan buyurtma ushlanmalari" : "Avtomatik ushlanmalar"}</h4><p>{historical ? "Bu buyurtma avval saqlangan ushlanmalar bilan hisoblanadi." : "Soliq bo‘limida rahbar saqlagan qoida qo‘llanadi. Yetkazish va chegirma butun buyurtmaga bir marta ayriladi."}</p></div>{onSettings && <button type="button" onClick={onSettings}>Soliq sozlamalari →</button>}</div>
      <div className="delivery-manual-fees">
        {rows.filter(({ key, always }) => always || Number(inputs[key].value) > 0).map(({ key, label }) => <div className="delivery-manual-fee" key={key}>
          <b>{label}</b><small>{inputs[key].unit === "percent" ? `${Number(inputs[key].value)}%` : `${won(Number(inputs[key].value))} / buyurtma`}</small><strong>−{won(fees[key])}</strong>
        </div>)}
      </div>
      {revenue > 0 && !valid && <p className="form-notice" role="alert">Ushlanma qoidasini Soliq bo‘limida tekshiring. Chegirma savdodan oshmasin.</p>}
      <p className="delivery-manual-total">Jami ushlanma <strong>{won(fees.total)} · {revenue > 0 ? (fees.total / revenue * 100).toFixed(2) : "0.00"}%</strong></p>
    </section>
    <div className="delivery-sale-preview">
      <span><small>Savdo</small><strong>{won(revenue)}</strong></span><span><small>Jami ushlanma</small><strong>−{won(fees.total)}</strong></span>
      <span className="delivery-settlement"><small>Kutiladigan o‘tkazma</small><strong>{won(settlement)}</strong><small>Platforma o‘tkazmasi bilan solishtiring</small></span>
      <span><small>Tannarx</small><strong>−{won(cost)}</strong></span><span className={contribution >= 0 ? "positive" : "negative"}><small>Tannarxdan keyin qoladi</small><strong>{won(contribution)}</strong><small>Marja {margin.toLocaleString("uz-UZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</small></span>
    </div>
    <p className="delivery-preview-note">Savdo to‘liq summasi bilan saqlanadi. Ushlanma alohida hisoblanib, qoladigan puldan ayriladi.</p>
  </>;
}
