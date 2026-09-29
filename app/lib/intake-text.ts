export function parseIntakeText(text: string) {
 const lines=text.split(/\n/).map(line=>line.trim()).filter(Boolean);
 if(!lines.length || lines.length>50) throw new Error('Har mahsulotni alohida qatorga yozing (ko‘pi bilan 50 ta).');
 return lines.map((line,index)=>{
  const match=line.match(/^(.+?)\s+(\d+(?:[.,]\d+)?)\s+(dona|ta|g|gr|kg|ml|l|litr|qadoq)\s+(?:₩\s*)?(\d[\d ,]*)\s*(?:von|won|₩)?$/i);
  if(!match)throw new Error(`${index+1}-qator tushunilmadi. Namuna: Un 2 kg 8000. Taxminiy summa kiritilmadi.`);
  const name=match[1].trim(); const quantity=match[2].replace(',','.');const unit=({ta:'dona',gr:'g',l:'litr'} as Record<string,string>)[match[3].toLowerCase()]||match[3].toLowerCase();
  const amount=match[4].replace(/[ ,]/g,'');
  if(!Number.isSafeInteger(Number(amount))||Number(amount)<=0||Number(quantity)<=0) throw new Error(`${index+1}-qator miqdori yoki summasi noto‘g‘ri.`);
  return {name,quantity,unit,amount};
 });
}
