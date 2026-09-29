/** MEZANA owns these stock/expense effects. Historical unlinked rows are never backfilled. */
type Row = Record<string, any>;
type State = Record<string, unknown>;
export type MezanaPosting = { kind: "stock" | "expense" | "none"; inventoryId?: string; unitsPerItem?: number; unit?: string; quantity?: number; amount?: number };
export class MezanaPostingError extends Error {}
const rows = (value: unknown): Row[] => Array.isArray(value) ? value : [];
export const mezanaNameKey = (value: unknown) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase("uz-UZ").replace(/[‘’ʻʼ`]/g, "'").replace(/\s+/g, " ");
const signature = (entry: Row) => JSON.stringify([entry.action, entry.productName, entry.quantity, entry.itemCount, entry.amount, entry.date]);
const count = (entry: Row) => Number(entry.action === "purchased" ? entry.itemCount : entry.quantity);
const effectId = (id: string) => `mezana-effect:${id}`;

export function syncMezanaPosting(previous: State, submitted: State): State {
  const oldEntries = rows(previous.mezanaEntries);
  const oldById = new Map(oldEntries.map((entry) => [entry.id, entry]));
  let inventory = rows(submitted.inventory).map((item) => ({ ...item }));
  let movements = rows(submitted.stockMovements).map((item) => ({ ...item }));
  let expenses = rows(submitted.financialEntries).map((item) => ({ ...item }));
  const catalog = rows(submitted.mezanaCatalog);
  const nextEntries = rows(submitted.mezanaEntries).map((entry) => ({ ...entry }));
  const nextById = new Map(nextEntries.map((entry) => [entry.id, entry]));
  const changes = new Map<string, number>();
  const change = (inventoryId: string, amount: number) => changes.set(inventoryId, (changes.get(inventoryId) || 0) + amount);

  for (const old of oldEntries) {
    const next = nextById.get(old.id);
    const posting = old.posting as MezanaPosting | undefined;
    if (!posting) continue;
    if (next && signature(next) === signature(old)) {
      // Ignore a stale client's attempt to strip server-owned metadata.
      next.posting = posting;
      const collection = posting.kind === "stock" ? movements : expenses;
      const original = rows(posting.kind === "stock" ? previous.stockMovements : previous.financialEntries).find((row) => row.id === effectId(old.id));
      if (original && (JSON.stringify(collection.find((row) => row.id === original.id)) !== JSON.stringify(original) || expenses.some((row) => row.reversedEntryId === original.id))) {
        throw new MezanaPostingError("MEZANAga bog‘langan yozuvni MEZANA bo‘limidan tahrirlang yoki o‘chiring.");
      }
      if (posting.kind === "stock" && !inventory.some((item) => item.id === posting.inventoryId)) throw new MezanaPostingError("Bu ombor mahsuloti MEZANA yozuviga bog‘langan. Avval MEZANA hisobini tekshiring.");
      continue;
    }
    if (posting.kind === "stock") change(posting.inventoryId!, -Number(posting.quantity));
    movements = movements.filter((row) => row.id !== effectId(old.id));
    expenses = expenses.filter((row) => row.id !== effectId(old.id));
  }

  for (const entry of nextEntries) {
    const old = oldById.get(entry.id);
    if (old && (!old.posting || signature(old) === signature(entry))) continue;
    // Restoring a legacy archived row must not silently create a second receipt.
    const archived = rows(previous.deletedItems).find((row) => row.kind === "mezanaEntry" && row.entityId === entry.id);
    if (!old && archived && !archived.record?.posting) continue;
    let savedPosting = (old?.posting || archived?.record?.posting) as MezanaPosting | undefined;
    if (!savedPosting && entry.action === "returned") {
      const linkedLoans = oldEntries.filter((row) => row.action === "borrowed" && mezanaNameKey(row.productName) === mezanaNameKey(entry.productName) && row.posting?.kind === "stock");
      if (!linkedLoans.length) { entry.posting = { kind: "none" }; continue; }
      const first = linkedLoans[0].posting as MezanaPosting;
      if (linkedLoans.some((row) => row.posting.inventoryId !== first.inventoryId || row.posting.unitsPerItem !== first.unitsPerItem)) throw new MezanaPostingError("Bu mahsulot turli qadoqlarda olingan. Qaytarishdan oldin ombor bog‘lanishini tekshiring.");
      const linkedBalance = oldEntries.filter((row) => mezanaNameKey(row.productName) === mezanaNameKey(entry.productName) && row.posting?.kind === "stock")
        .reduce((sum, row) => sum + (row.action === "borrowed" ? Number(row.quantity) : row.action === "returned" ? -Number(row.quantity) : 0), 0);
      if (count(entry) > linkedBalance) throw new MezanaPostingError("Qaytarishda eski va yangi ombor kirimlarini aralashtirmang. Bog‘langan olib turish qoldig‘idan oshib ketdi.");
      savedPosting = first;
    }
    if (old?.posting && mezanaNameKey(old.productName) !== mezanaNameKey(entry.productName)) throw new MezanaPostingError("Bog‘langan mahsulot nomini almashtirmang. Boshqa mahsulot uchun eski yozuvni o‘chirib, yangisini kiriting.");
    let posting: MezanaPosting = { kind: "none" };
    const item = catalog.find((item) => item.id === entry.catalogItemId);
    if (["borrowed", "purchased", "returned"].includes(entry.action)) {
      let target: Row | undefined;
      let units = 1;
      if (savedPosting?.kind === "stock") {
        target = inventory.find((row) => row.id === savedPosting.inventoryId);
        units = Number(savedPosting.unitsPerItem);
        if (!target) throw new MezanaPostingError("Bog‘langan ombor mahsuloti topilmadi. Avval uni tiklang.");
      } else if (savedPosting?.kind !== "expense") {
        if (item?.inventoryId) {
          target = inventory.find((row) => row.id === item.inventoryId);
          units = Number(item.inventoryUnitsPerItem);
          if (!target) throw new MezanaPostingError("MEZANA mahsulotining ombor bog‘lanishini yangilang.");
        } else {
          const matches = inventory.filter((row) => mezanaNameKey(row.name) === mezanaNameKey(entry.productName));
          if (matches.length > 1) throw new MezanaPostingError("Omborda shu nomli bir nechta mahsulot bor. Rahbar MEZANA ro‘yxatida aniq mahsulotni tanlasin.");
          target = matches[0];
          if (target && target.unit !== "dona") throw new MezanaPostingError(`«${entry.productName}» omborda ${target.unit} bilan yuritiladi. Rahbar MEZANA mahsulotida 1 donaning ombor miqdorini belgilasin.`);
        }
      }
      if (target) {
        if (!Number.isFinite(units) || units <= 0 || units > 1_000_000_000 || !Number.isSafeInteger(count(entry)) || count(entry) <= 0) throw new MezanaPostingError("Mahsulot soni va omborga o‘tadigan miqdorni tekshiring.");
        const quantity = count(entry) * units * (entry.action === "returned" ? -1 : 1);
        posting = { kind: "stock", inventoryId: target.id, unitsPerItem: units, unit: target.unit, quantity };
        change(target.id, quantity);
        movements.push({ id: effectId(entry.id), inventoryId: target.id, type: quantity > 0 ? "receipt" : "adjustment", quantity, date: entry.date, referenceId: entry.id, mezanaEntryId: entry.id,
          note: `MEZANA · ${entry.action === "returned" ? "Qaytarildi" : entry.action === "borrowed" ? "Olib turildi" : "Sotib olindi"} · ${entry.productName}`,
          unitCost: Number(entry.unitPrice || 0) / units });
      } else if (entry.action === "purchased") {
        posting = { kind: "expense", amount: Number(entry.amount) };
        // Accrued expense: debt stays in MEZANA; no cash/card payment is invented.
        expenses.push({ id: effectId(entry.id), type: "expense", category: "MEZANA xaridi", amount: Number(entry.amount), date: entry.date,
          accountId: "", affectsProfit: true, nonCash: true, mezanaEntryId: entry.id, note: `MEZANA · ${entry.productName} · qarz hisobi MEZANA bo‘limida` });
      }
    }
    entry.posting = posting;
  }
  inventory = inventory.map((item) => {
    const delta = changes.get(item.id) || 0;
    const stock = Number(item.stock) + delta;
    if (!Number.isFinite(stock) || (delta < 0 && stock < -0.000001)) throw new MezanaPostingError(`«${item.name}» ombor qoldig‘i yetarli emas. Ishlatilgan mahsulotni qaytarish yoki kirimini o‘chirishdan oldin hisobni tekshiring.`);
    return delta ? { ...item, stock } : item;
  });
  for (const id of changes.keys()) if (!inventory.some((item) => item.id === id)) throw new MezanaPostingError("MEZANAga bog‘langan ombor mahsulotini avval tiklang.");
  return { ...submitted, inventory, stockMovements: movements, financialEntries: expenses, mezanaEntries: nextEntries };
}
