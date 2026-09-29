import type { BusinessIssue } from "./lib/business-audit";
import { auditBusinessState } from "./lib/business-audit";

export default function BusinessAuditPanel({ audit, onOpen }: {
  audit: ReturnType<typeof auditBusinessState>;
  onOpen: (tab: BusinessIssue["tab"]) => void;
}) {
  return <section className={`finance-shield ${audit.errorCount ? "danger" : "safe"}`} aria-label="Hisob ishonchliligi">
    <div className="finance-shield-head"><span><b>HISOB ISHONCHLILIGI</b><small>{audit.checked.sales} savdo · {audit.checked.inventory} mahsulot · {audit.checked.suppliers} yetkazuvchi tekshirildi</small></span><strong>{audit.errorCount ? `${audit.errorCount} yo‘nalishda xato` : "Hisob tengliklari tekshirildi"}</strong></div>
    <p>{audit.issues.length ? `${audit.reviewCount} yo‘nalishda hujjat yoki ma’lumot tekshiruvi kerak. Quyidagi yozuvlar o‘zicha tuzatilmaydi.` : "Tekshirilgan qoidalarda nomuvofiqlik topilmadi. Kassa va bankni haqiqiy qoldiq bilan solishtirib kunni yoping."}</p>
    {audit.issues.map((issue) => <details key={issue.code} className="business-audit-issue"><summary>{issue.severity === "error" ? "Xato" : "Tekshirish kerak"}: {issue.title} · {issue.count} yozuv</summary><p>{issue.detail}</p><ul>{issue.examples.map((name, index) => <li key={index}>{name}</li>)}</ul><button type="button" onClick={() => onOpen(issue.tab)}>Tegishli bo‘limni ochish →</button></details>)}
    <details className="business-audit-issue"><summary>Foyda va soliq qanday talqin qilinadi?</summary><p>Hisobiy foyda — kiritilgan savdo, tannarx, xarajat va reja zaxirasidan hisoblangan boshqaruv natijasi. Bu bankdagi pul qoldig‘i emas. Xarajat yoki tannarx yetishmasa, natija ham to‘liq emas.</p><p>Avtomatik soliq foizi faqat reja zaxirasi. Bu QQS deklaratsiyasi yoki to‘lanadigan soliq summasi emas. Delivery xizmatlaridan ushlangan 부가세 sizning barcha savdolaringiz bo‘yicha QQS hisobini almashtirmaydi.</p><p>Ombor qiymati hozir oxirgi kirim narxida baholanadi; savdo tannarxi saqlangan retsept asosida. Rasmiy buxgalteriya hisoboti uchun buxgalter bilan solishtiring.</p></details>
  </section>;
}
