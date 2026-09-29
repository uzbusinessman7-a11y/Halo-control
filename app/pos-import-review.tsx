import type { reconcilePosImport } from "./lib/pos-reconciliation";

type Props = {
  result: ReturnType<typeof reconcilePosImport>;
  date: string;
  reportTotal?: number;
  recipes: Array<{ id: string; name: string }>;
};
const won = (value: number) => `${Math.round(value).toLocaleString("en-US")}₩`;
const labels = { new: "Yangi qo‘shiladi", saved: "Oldin saqlangan", conflict: "Tekshirish kerak", unmatched: "Menyu tanlanmagan" };

export default function PosImportReview({ result, date, reportTotal, recipes }: Props) {
  const quantity = result.rows.reduce((sum, row) => sum + row.quantity, 0);
  const difference = reportTotal !== undefined && result.projectedRevenue !== null
    ? result.projectedRevenue - reportTotal : null;
  const name = (recipeId: string, code: string) => recipes.find((recipe) => recipe.id === recipeId)?.name || code;
  return <section className="pos-reconciliation" aria-label="POS import hisobini solishtirish">
    <p className="pos-reconciliation-date"><b>{date}</b> · {result.rows.length} ta mahsulot qatori · {quantity} dona</p>
    <div className="pos-reconciliation-totals">
      {reportTotal !== undefined && <article><span>Excel faylidagi jami</span><strong>{won(reportTotal)}</strong><small>POS hisobotidagi yakuniy summa</small></article>}
      <article><span>HALO menyusi bo‘yicha jami</span><strong>{result.unmatchedRows.length ? "—" : won(result.menuRevenue)}</strong><small>Barcha qator · joriy menyu narxlari</small></article>
      <article><span>Oldin saqlangan</span><strong>{won(result.savedRevenue)}</strong><small>{result.savedRows.length} qator · qayta qo‘shilmaydi</small></article>
      <article className="primary"><span>Hozir yangi qo‘shiladi</span><strong>{won(result.newRevenue)}</strong><small>{result.newRows.length} qator · faqat yangi savdo</small></article>
    </div>
    {result.projectedRevenue !== null && <p>Shu fayl bo‘yicha saqlangan va yangi savdo jami: <b>{won(result.projectedRevenue)}</b>. Oldingi yozuvlar saqlangan narxida qoladi.</p>}
    {difference !== null && difference !== 0 && <p className="pos-reconciliation-warning" role="status">Excel bilan farq: <b>{difference > 0 ? "+" : ""}{won(difference)}</b>. Oldin saqlangan summalar yoki summasi yo‘q qatorlar Excel bilan farq qiladi. Quyidagi qatorlarda solishtiring.</p>}
    {!!result.conflicts.length && <div className="pos-reconciliation-warning" role="alert"><b>{result.conflicts.length} qator mos kelmadi — import to‘xtatildi.</b><ul>{result.conflicts.map((row) => <li key={row.rowNumber}>{name(row.recipeId, row.productCode)}: {row.conflict === "file_duplicate" ? "faylda bir xil sana va kod qaytarilgan" : row.conflict === "saved_duplicate" ? "shu sana va kod bilan bir nechta yozuv saqlangan" : `faylda ${row.quantity} dona, saqlangani ${row.savedQuantity} dona; summa: ${won(row.totalRevenue)} / ${won(row.savedRevenue)}; sana va menyuni ham tekshiring`}.</li>)}</ul><p>POS savdo tarixidagi shu sana yozuvlarini tekshiring. Tizim farqli yozuvni avtomatik tashlab ketmaydi.</p></div>}
    {result.rows.some((row) => row.revenueSource !== "pos_actual") && <p className="pos-reconciliation-warning">Ayrim qatorlarda POS summasi yo‘q. Bu qatorlar menyu narxi bo‘yicha TAXMINAN hisoblanadi; haqiqiy POS tushumi bilan tekshiring.</p>}
    <details className="pos-reconciliation-detail"><summary>Qatorlar bo‘yicha hisobni ko‘rish</summary><div className="pos-reconciliation-table"><table><thead><tr><th>Mahsulot / kod</th><th>Faylda</th><th>Saqlangan</th><th>Excel summasi</th><th>HALO summasi</th><th>Holat</th></tr></thead><tbody>{result.rows.map((row) => <tr key={row.rowNumber} className={row.status === "conflict" ? "warning" : ""}><td>{name(row.recipeId, row.productCode)}<small>{row.productCode} · {row.date}</small></td><td>{row.quantity} dona</td><td>{row.existingCount ? `${row.savedQuantity} dona` : "—"}</td><td>{row.referenceRevenue === undefined ? "—" : won(row.referenceRevenue)}</td><td>{row.status === "saved" ? won(row.savedRevenue) : row.status === "new" ? won(row.importRevenue) : "—"}</td><td>{labels[row.status]}</td></tr>)}</tbody></table></div></details>
  </section>;
}
