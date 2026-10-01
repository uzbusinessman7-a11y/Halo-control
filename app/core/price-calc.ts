/**
 * HALO V2 — narx va foiz kalkulyatori (bitta formula: menyu muharriri va alohida kalkulyator sahifasi shu kodni ishlatadi).
 *
 * Asosiy savol: tannarx 5 000 ₩ bo'lsa, u sotuv narxining 30% / 35% / 40% bo'lishi uchun narx qancha?
 *   narx = tannarx × 100 ÷ foiz   (5 000 → 30%: 16 667, 35%: 14 286, 40%: 12 500)
 * Ixtiyoriy: soliq va karta komissiyasidan keyin qolgan pulga nisbatan (POS savdo uchun aniqroq):
 *   narx = tannarx × 100 ÷ foiz × 100 ÷ (100 − ushlanma%)
 * Narx doim YUQORIGA yaxlitlanadi (foiz maqsaddan oshib ketmasligi uchun): 1 ₩, 100 ₩, 500 ₩ yoki 1 000 ₩ gacha.
 *
 * Kod oddiy brauzer JavaScript'i (matn) — sahifaga qo'yiladi va testlarda xuddi shu matn ishlatiladi.
 */
export const PRICE_CALC_JS = `
function pcNum(v){var s=String(v==null?'':v).replace(/[\\s,₩%]/g,'').replace(/[^0-9.\\-]/g,'');var n=Number(s);return isFinite(n)?n:0}
function pcP(v){var n=Number(String(v==null?'':v).trim().replace(',','.').replace(/[^0-9.\\-]/g,''));return isFinite(n)?n:0}
function pcClean(x){return Math.round(x*1e6)/1e6}
function pcRoundUp(value,step){if(!(value>0))return 0;var s=step>0?step:1;return Math.ceil(pcClean(value/s)-1e-9)*s}
function pcPriceForCost(cost,pct,deductPct,step){cost=pcNum(cost);pct=pcP(pct);deductPct=pcP(deductPct);
  if(!(cost>0)||!(pct>0)||pct>=100||deductPct<0||deductPct>=100)return null;
  var exact=pcClean(cost*100/pct);if(deductPct>0)exact=pcClean(exact*100/(100-deductPct));
  var price=pcRoundUp(exact,step),net=pcClean(price*(100-deductPct)/100);
  return {pct:pct,exact:exact,price:price,net:net,profit:Math.round(net-cost),realPct:Math.round(cost/net*1000)/10}}
function pcMarkup(cost,pct,step){cost=pcNum(cost);pct=pcP(pct);if(!(cost>0)||pct<0)return null;var exact=pcClean(cost*(100+pct)/100);var price=pcRoundUp(exact,step);
  return {pct:pct,exact:exact,price:price,profit:Math.round(price-cost),realPct:Math.round(cost/price*1000)/10}}
function pcAdd(x,p){return pcClean(pcNum(x)*(100+pcP(p))/100)}
function pcSub(x,p){return pcClean(pcNum(x)*(100-pcP(p))/100)}
function pcPart(x,p){return pcClean(pcNum(x)*pcP(p)/100)}
function pcInside(x,p){x=pcNum(x);p=pcP(p);var base=pcClean(x*100/(100+p));return {base:base,part:pcClean(x-base)}}
function pcRatio(a,b){a=pcNum(a);b=pcNum(b);return b?pcClean(a/b*100):null}
function pcChange(from,to){from=pcNum(from);to=pcNum(to);return from?pcClean((to-from)/from*100):null}
function pcFmt(n,dec){if(n==null||!isFinite(n))return '—';return Number(n).toLocaleString('en-US',{maximumFractionDigits:dec==null?2:dec})}
`;

/** Yaxlitlash variantlari (₩). */
export const PRICE_STEPS = [
  { step: 100, label: "100 ₩" },
  { step: 500, label: "500 ₩" },
  { step: 1000, label: "1 000 ₩" },
  { step: 1, label: "Aniq (1 ₩)" },
];
