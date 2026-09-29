"use client";

import { DELIVERY_PLATFORMS, deliveryPlatformShortLabel, type DeliveryPlatform, type DeliveryPlatformPrices } from "../lib/delivery-sales";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  announceHaloStateChange,
  HALO_LIVE_SYNC_INTERVAL_MS,
  subscribeHaloStateChanges,
} from "../lib/live-state";
import { seoulBusinessDate } from "../lib/business-time";
import { filterPosCatalog, groupPosCatalog } from "../lib/pos-catalog";
import {
  duplicateEntryConfirmationMessage,
  findPotentialDuplicateEntries,
} from "../lib/duplicate-entry-warning";

type Branch = { id: string; name: string; configured?: boolean };
type CatalogItem = { id: string; name: string; posCode?: string; categoryId: string; salePrice: number; deliveryPrices?: DeliveryPlatformPrices };
type Category = { id: string; name: string; sortOrder?: number };
type OrderLine = { id: string; recipeId: string; name: string; quantity: number; unitPrice: number; total: number };
type PosOrder = {
  id: string;
  orderNumber: number;
  date: string;
  paymentType: "cash" | "card" | "bank" | "delivery";
  deliveryPlatform?: DeliveryPlatform;
  deliveryOrderNumber?: string;
  status: "new" | "preparing" | "done";
  items: OrderLine[];
  total: number;
  note: string;
  workerName: string;
  createdAt: string;
  editedAt?: string;
  editable?: boolean;
  stockShortages?: Array<{ inventoryId: string; name: string; unit: string; quantity: number }>;
};
type InventoryOutflow = {
  id: string;
  kind: "meal" | "product" | "waste" | "inventory_only";
  recipeId?: string;
  label: string;
  quantity: number;
  unit: string;
  reason: string;
  outflowCategory?: "kitchen_consumption" | "other_inventory_outflow";
  isKitchenConsumption?: boolean;
  note: string;
  workerName: string;
  date: string;
  stockShortages?: Array<{ inventoryId: string; name: string; unit: string; quantity: number }>;
  createdAt: string;
  editedAt?: string;
  editable?: boolean;
  items?: Array<{ recipeId: string; name: string; quantity: number }>;
};
type EditingRecord = { id: string; type: "sale" | "inventory_only" };
type TerminalData = {
  publicEntry?: boolean;
  branches?: Branch[];
  catalog: CatalogItem[];
  productCategories: Category[];
  orders: PosOrder[];
  inventoryOutflows: InventoryOutflow[];
  workerName: string;
  branchId: string;
  updatedAt: string;
};

const emptyTerminal: TerminalData = {
  catalog: [],
  productCategories: [],
  orders: [],
  inventoryOutflows: [],
  workerName: "",
  branchId: "",
  updatedAt: "",
};
const won = (value: number) => `₩${Math.round(value).toLocaleString("en-US")}`;
const recordDateTime = (value: string) => new Date(value).toLocaleString("uz-UZ", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
});
const inventoryOutflowReasons = [
  "Oshxonada yeyilgan ovqat",
  "Isrof / buzilgan",
  "Bepul berildi / namuna",
  "Ichki foydalanish",
  "Boshqa nosavdo chiqim",
] as const;

type PosTerminalScreenProps = {
  publicEntry?: boolean;
  enableDelivery?: boolean;
  initialMode?: "sale" | "inventory_only";
  initialPaymentType?: "cash" | "card" | "bank";
  salePaymentOptions?: Array<"cash" | "card" | "bank">;
  lockMode?: boolean;
  inventoryReasons?: readonly string[];
  inventoryModeTitle?: string;
  inventoryModeHelp?: string;
  terminalSubtitle?: string;
};

export function PosTerminalScreen({
  publicEntry = false,
  enableDelivery = false,
  initialMode = "sale",
  initialPaymentType = "card",
  salePaymentOptions = ["cash", "bank", "card"],
  lockMode = false,
  inventoryReasons = inventoryOutflowReasons,
  inventoryModeTitle = "FAQAT OMBOR CHIQIMI",
  inventoryModeHelp = "Haqiqiy savdo bo‘lmagan holat",
  terminalSubtitle,
}: PosTerminalScreenProps) {
  const terminalApi = publicEntry ? "/api/hisob" : "/api/pos-terminal";
  const [entryDate, setEntryDate] = useState("");
  const [terminal, setTerminal] = useState<TerminalData>(emptyTerminal);
  const [terminalReady, setTerminalReady] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("main");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paymentType, setPaymentType] = useState<"cash" | "card" | "bank" | "delivery">(initialPaymentType);
  const [entryMode, setEntryMode] = useState<"sale" | "inventory_only">(initialMode);
  const [inventoryReason, setInventoryReason] = useState<string>(inventoryReasons[0] || inventoryOutflowReasons[0]);
  const [deliveryPlatform,setDeliveryPlatform]=useState<DeliveryPlatform|''>('');
  const isDelivery=entryMode==='sale' && paymentType==='delivery';
  const switchChannel=(delivery:boolean,platform:DeliveryPlatform|''=deliveryPlatform)=>{
    if(busy)return;
    if(Object.values(cart).some(n=>n>0) && !window.confirm('Savdo turi yoki platforma o‘zgarsa tanlangan taomlar tozalanadi. Davom etasizmi?'))return;
    setCart({});setSearch('');setEditingRecord(null);pendingOperationId.current='';setEntryMode('sale');setPaymentType(delivery?'delivery':initialPaymentType);setDeliveryPlatform(platform);setNotice('');
  };
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionBusyId, setActionBusyId] = useState("");
  const [editingRecord, setEditingRecord] = useState<EditingRecord | null>(null);
  const pendingOperationId = useRef("");
  const terminalRevisionRef = useRef("");
  const terminalRefreshInFlightRef = useRef(false);

  const refreshTerminal = useCallback(async (quiet: boolean, selectedBranchId: string) => {
    if (!quiet) setCatalogLoading(true);
    try {
      const response = await fetch(`${terminalApi}?branch=${encodeURIComponent(selectedBranchId)}`, {
        cache: "no-store",
      });
      const value = await response.json() as TerminalData & { error?: string };
      setNeedsLogin(response.status === 401);
      if (response.status === 401) {
        setTerminal(emptyTerminal);
        terminalRevisionRef.current = "";
      }
      if (!response.ok) throw new Error(value.error || "POS terminal ochilmadi.");
      setCatalogError("");
      terminalRevisionRef.current = value.updatedAt || "";
      setTerminal(value);
      if (value.branches?.length) setBranches(value.branches);
      if (value.branchId && value.branchId !== selectedBranchId) setBranchId(value.branchId);
      if (!quiet) setNotice("");
      return true;
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "Mahsulotlar yuklanmadi. Ulanishni tekshirib, qayta urinib ko‘ring.");
      return false;
    } finally {
      if (!quiet) setCatalogLoading(false);
    }
  }, [terminalApi]);

  useEffect(() => {
    let active = true;
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
    const bootstrap = async () => {
      try {
        const url = new URL(window.location.href);
        const requestedBranch = url.searchParams.get("branch") || "main";
        await refreshTerminal(false, requestedBranch);
      } catch {
        if (active) setNotice("POS terminalga ulanib bo‘lmadi. Sahifani yangilang.");
      } finally {
        if (active) setTerminalReady(true);
      }
    };
    void bootstrap();
    return () => { active = false; };
  }, [refreshTerminal]);

  useEffect(() => {
    if (!terminalReady) return;
    const checkTerminalRevision = async () => {
      if (terminalRefreshInFlightRef.current || document.visibilityState !== "visible") return;
      terminalRefreshInFlightRef.current = true;
      try {
        const response = await fetch(
          `${terminalApi}?branch=${encodeURIComponent(branchId)}&revision=1`,
          { cache: "no-store" },
        );
        const value = await response.json() as { branchId?: string; updatedAt?: string };
        if (
          response.status === 401 || (response.ok
          && value.updatedAt
          && value.updatedAt !== terminalRevisionRef.current)
        ) await refreshTerminal(true, value.branchId || branchId);
      } catch {
        // Keyingi tekshiruv avtomatik qayta urinadi.
      } finally {
        terminalRefreshInFlightRef.current = false;
      }
    };
    const refreshVisible = () => {
      if (document.visibilityState === "visible") void checkTerminalRevision();
    };
    const interval = window.setInterval(() => void checkTerminalRevision(), HALO_LIVE_SYNC_INTERVAL_MS);
    const unsubscribe = subscribeHaloStateChanges((signal) => {
      if (signal.branchId === branchId) void checkTerminalRevision();
    });
    window.addEventListener("focus", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => {
      window.clearInterval(interval);
      unsubscribe();
      window.removeEventListener("focus", refreshVisible);
      document.removeEventListener("visibilitychange", refreshVisible);
    };
  }, [branchId, terminalReady, refreshTerminal, terminalApi]);

  const changeBranch = async (nextBranchId: string) => {
    setBranchId(nextBranchId);
    setCart({});
    setSearch("");
    setTerminal(emptyTerminal);
    terminalRevisionRef.current = "";
    setEditingRecord(null);
    setNotice("");
    const url = new URL(window.location.href);
    url.searchParams.set("branch", nextBranchId);
    window.history.replaceState({}, "", url);
    await refreshTerminal(false, nextBranchId);
  };

  const pricedCatalog=useMemo(()=>terminal.catalog.map(item=>({...item,salePrice:isDelivery?(deliveryPlatform?item.deliveryPrices?.[deliveryPlatform]||0:0):item.salePrice})),[terminal.catalog,isDelivery,deliveryPlatform]);
  const visibleCatalog = useMemo(() => filterPosCatalog(pricedCatalog, terminal.productCategories, search), [search, pricedCatalog, terminal.productCategories]);
  const catalogGroups = useMemo(() => groupPosCatalog(pricedCatalog, terminal.productCategories, search), [pricedCatalog, terminal.productCategories, search]);
  const searchMatchIds = new Set(search.trim() ? visibleCatalog.map(item => item.id) : []);
  const cartItems = pricedCatalog.flatMap((item) => {
    const quantity = Number(cart[item.id] || 0);
    return quantity > 0 ? [{ ...item, quantity, total: item.salePrice * quantity }] : [];
  });
  const cartTotal = cartItems.reduce((sum, item) => sum + item.total, 0);
  const cartQuantity = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const fixedInventoryReason = inventoryReasons.length === 1 ? inventoryReasons[0] : "";
  const selectedInventoryReason = fixedInventoryReason || inventoryReason;
  const setQuantity = (recipeId: string, quantity: number) => {
    pendingOperationId.current = "";
    setCart((current) => ({ ...current, [recipeId]: Math.max(0, Math.min(1_000, Math.round(quantity))) }));
  };

  const focusEntryForm = () => {
    window.requestAnimationFrame(() => document.querySelector(".pos-cart-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const editSale = (order: PosOrder) => {
    setEntryDate(order.date);
    const quantities = Object.fromEntries(order.items.map((item) => [item.recipeId, item.quantity]));
    setEditingRecord({ id: order.id, type: "sale" });
    setEntryMode("sale");
    setPaymentType(order.paymentType);
    setCart(quantities);
    setNote(order.note || "");
    setNotice("Tahrirlash rejimi: mahsulot, soni yoki to‘lov turini to‘g‘rilang.");
    pendingOperationId.current = "";
    focusEntryForm();
  };

  const editInventoryOutflow = (entry: InventoryOutflow) => {
    setEntryDate(entry.date);
    const lines = entry.items?.length
      ? entry.items.map((item) => ({ recipeId: item.recipeId, quantity: item.quantity }))
      : entry.recipeId ? [{ recipeId: entry.recipeId, quantity: entry.quantity }] : [];
    const availableLines = lines.filter((item) => terminal.catalog.some((recipe) => recipe.id === item.recipeId));
    if (!availableLines.length) {
      setNotice("Bu eski yozuvdagi taom menyudan o‘chirilgan. Uni tahrirlab bo‘lmaydi, lekin o‘chirish mumkin.");
      return;
    }
    setEditingRecord({ id: entry.id, type: "inventory_only" });
    setEntryMode("inventory_only");
    setInventoryReason("Oshxonada yeyilgan ovqat");
    setCart(Object.fromEntries(availableLines.map((item) => [item.recipeId, item.quantity])));
    setNote(entry.note || "");
    setNotice("Tahrirlash rejimi: yeyilgan taom va sonini to‘g‘rilang.");
    pendingOperationId.current = "";
    focusEntryForm();
  };

  const cancelEditing = () => {
    setEntryDate("");
    setEditingRecord(null);
    setCart({});
    setNote("");
    setNotice("Tahrirlash bekor qilindi.");
    pendingOperationId.current = "";
  };

  const deleteRecord = async (record: EditingRecord) => {
    const label = record.type === "sale" ? "savdoni" : "yeyilgan mahsulot yozuvini";
    if (!window.confirm(`${label} o‘chirasizmi? Ombordan ayrilgan mahsulotlar avtomatik qaytariladi.`)) return;
    setActionBusyId(record.id);
    setNotice("");
    try {
      const response = await fetch(terminalApi, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, recordId: record.id, recordType: record.type }),
      });
      const value = await response.json() as TerminalData & { error?: string };
      if (!response.ok) throw new Error(value.error || "Yozuv o‘chirilmadi.");
      terminalRevisionRef.current = value.updatedAt || "";
      setTerminal(value);
      announceHaloStateChange(value.branchId || branchId, value.updatedAt);
      if (editingRecord?.id === record.id) {
        setEditingRecord(null);
        setCart({});
        setNote("");
      }
      setNotice(record.type === "sale"
        ? "✓ Savdo o‘chirildi; tushum, tannarx va ombor qoldig‘i qayta hisoblandi."
        : "✓ Yeyilgan mahsulot o‘chirildi; ombor qoldig‘i qaytarildi.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Yozuv o‘chirilmadi.");
    } finally {
      setActionBusyId("");
    }
  };

  const saveOrder = async () => {
    if(busy)return;
    if(isDelivery && (!deliveryPlatform || cartItems.some(i=>!i.salePrice))){setNotice('Platforma va alohida delivery narxlarini tekshiring.');return;}
    if (!cartItems.length) {
      setNotice("Kamida bitta taom tanlang.");
      return;
    }
    const probeId = `duplicate-probe:${crypto.randomUUID()}`;
    const date = entryDate || seoulBusinessDate(new Date());
    const probeItems = cartItems.map((item) => ({ recipeId: item.id, name: item.name, quantity: item.quantity, total: item.total }));
    const duplicateWarnings = editingRecord ? [] : entryMode === "sale"
      ? findPotentialDuplicateEntries(
        { posOrders: terminal.orders },
        {
          posOrders: [{
            id: probeId,
            date,
            paymentType,
            total: cartTotal,
            items: probeItems,
          }, ...terminal.orders],
        },
      )
      : findPotentialDuplicateEntries(
        { workerConsumptions: terminal.inventoryOutflows },
        {
          workerConsumptions: [{
            id: probeId,
            kind: "inventory_only",
            date,
            reason: selectedInventoryReason,
            label: probeItems.length === 1 ? probeItems[0].name : `${probeItems.length} tur taom`,
            quantity: cartQuantity,
            unit: "porsiya",
            items: probeItems,
          }, ...terminal.inventoryOutflows],
        },
      );
    if (duplicateWarnings.length && !window.confirm(duplicateEntryConfirmationMessage(duplicateWarnings))) {
      setNotice("Takroriy yozuv saqlanmadi. To‘lov turi, taomlar va sonini tekshiring.");
      return;
    }
    setBusy(true);
    setNotice("");
    const operationId = pendingOperationId.current || crypto.randomUUID();
    pendingOperationId.current = operationId;
    try {
      const response = await fetch(terminalApi, {
        method: editingRecord ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId,
          date,
          branchId,
          mode: entryMode,
          ...(editingRecord ? { recordId: editingRecord.id, recordType: editingRecord.type } : {}),
          ...(entryMode === "sale" ? { paymentType } : { inventoryReason: selectedInventoryReason }),
          ...(isDelivery?{deliveryPlatform,expectedTotal:cartTotal}:{}),
          items: cartItems.map((item) => ({ recipeId: item.id, quantity: item.quantity })),
          ...(entryMode === "sale" && note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const value = await response.json() as TerminalData & { order?: PosOrder; inventoryOutflow?: InventoryOutflow; error?: string };
      if (!response.ok || (entryMode === "sale" ? !value.order : !value.inventoryOutflow)) {
        if (response.status < 500) pendingOperationId.current = "";
        throw new Error(value.error || "Yozuv saqlanmadi.");
      }
      terminalRevisionRef.current = value.updatedAt || "";
      setTerminal(value);
      announceHaloStateChange(value.branchId || branchId, value.updatedAt);
      setCart({});
      setNote("");
      const wasEditing = Boolean(editingRecord);
      setEditingRecord(null);
      pendingOperationId.current = "";
      setEntryDate("");
      setNotice((entryMode === "sale" && value.order
        ? `✓ Savdo ${wasEditing ? "tahrirlandi va qayta hisoblandi" : "saqlandi"} · ${isDelivery ? deliveryPlatformShortLabel(deliveryPlatform) : paymentType === "card" ? "Karta" : paymentType === "bank" ? "Hisob-raqam" : "Naqd"} · ${won(value.order.total)} · Soliq avtomatik hisoblanmadi${value.order.stockShortages?.length ? " · Ombor yetishmasa ham savdo hisobga olindi" : ""}`
        : `✓ Oshxonada yeyilgan ovqat ${wasEditing ? "tahrirlandi va ombor qayta hisoblandi" : `${cartQuantity} porsiya ombordan ayrildi`}${value.inventoryOutflow?.stockShortages?.length ? "; yetishmagan qoldiq manfiy ko‘rsatildi" : ""}.`) + ` · Sana: ${date}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Yozuv saqlanmadi.");
    } finally {
      setBusy(false);
    }
  };

  if (!terminalReady) return <main className="pos-terminal-login"><section><div className="pos-terminal-brand"><i>H</i><span><b>HALO HISOB</b><small>Mahsulotlar yuklanmoqda…</small></span></div></section></main>;

  const visibleSales = terminal.orders
    .filter((order) => isDelivery ? order.paymentType==='delivery' : order.paymentType!=='delivery' && salePaymentOptions.includes(order.paymentType))
    .slice(0, 30);
  const visibleInventoryReasons = new Set([
    ...inventoryReasons,
    ...(inventoryReasons.includes("Oshxonada yeyilgan ovqat") ? ["Xodim ovqati"] : []),
  ]);
  const visibleInventoryOutflows = terminal.inventoryOutflows
    .filter((entry) => entry.isKitchenConsumption === true
      || entry.kind === "meal"
      || visibleInventoryReasons.has(entry.reason))
    .slice(0, 30);
  const showOutflowHistory = !lockMode || initialMode === "inventory_only";

  return <main className="pos-terminal-shell">
    <header className="pos-terminal-header">
      <div className="pos-terminal-brand"><i>H</i><span><b>HALO HISOB</b><small>{terminalSubtitle || (lockMode ? initialMode === "inventory_only" ? "Faqat nosavdo ombor chiqimi" : "Naqd va hisob-raqam savdosi" : "Naqd, hisob-raqam va oshxonada yeyilgan ovqat")}</small></span></div>
      <div><span className={`pos-live${catalogError ? " pos-live-error" : ""}`}><i /> {needsLogin ? "KIRISH KERAK" : catalogError ? "ULANISH XATOSI" : terminal.publicEntry ? "OCHIQ KIRISH" : "HIMOYALANGAN"}</span>{branches.length > 1 && <select aria-label="Filialni tanlash" value={branchId} onChange={(event) => void changeBranch(event.target.value)}>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select>}<b>Hisob oynasi</b></div>
    </header>
    {enableDelivery && <section className="pos-channel-panel"><h2>1. Savdo turini tanlang</h2><div className="pos-channel-buttons"><button type="button" disabled={busy} aria-pressed={!isDelivery && entryMode==='sale'} onClick={()=>switchChannel(false)}>DO‘KON SAVDOSI<br/><small>Naqd / hisob-raqam · oddiy narx</small></button><button type="button" disabled={busy} aria-pressed={isDelivery} onClick={()=>switchChannel(true)}>DELIVERY SAVDOSI<br/><small>Coupang / Baemin / Yogiyo · alohida narx</small></button></div>{isDelivery && <><label>2. Qaysi platforma?<select disabled={busy} value={deliveryPlatform} onChange={e=>switchChannel(true,e.target.value as DeliveryPlatform|'')}><option value="">Platformani tanlang</option>{DELIVERY_PLATFORMS.map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label><p><b>{deliveryPlatform?deliveryPlatformShortLabel(deliveryPlatform):'Platforma tanlanmagan'} · DELIVERY NARXLARI</b> — quyida faqat shu platforma uchun rahbar belgilagan narxlar ishlaydi.</p></>}</section>}
    <div className="pos-terminal-grid">
      <section className="pos-catalog-panel">
        <div className="pos-panel-title"><span><small>01 · MAHSULOTLAR</small><h1>Sotilgan yoki yeyilgan taomni kiriting</h1></span></div>
        <div className="pos-catalog-search">
          <label><span>Taom nomi yoki kodi</span><div><input type="search" aria-label="Taom qidirish" placeholder="Masalan: lavash" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={event => { if (event.key === "Escape") setSearch(""); }} />{search && <button type="button" aria-label="Qidiruvni tozalash" onClick={() => setSearch("")}>✕</button>}</div></label>
          <button type="button" onClick={() => setSearch("")} aria-pressed={!search}>Barcha mahsulotlar{terminal.catalog.length ? ` (${terminal.catalog.length})` : ""}</button>
        </div>
        {catalogError && <div className="pos-catalog-message" role="alert"><strong>{needsLogin ? "Mahsulotlarni ko‘rish uchun hisobga kiring" : "Mahsulotlarni yuklashda xato"}</strong><p>{catalogError}</p>{needsLogin && <div><a href="/worker">Xodim sifatida kirish</a><a href="/">Rahbar sifatida kirish</a></div>}<button type="button" disabled={catalogLoading} onClick={() => void refreshTerminal(false, branchId)}>{catalogLoading ? "Yuklanmoqda…" : "Qayta yuklash"}</button></div>}
        {!catalogError && catalogLoading && <p role="status">Mahsulotlar yuklanmoqda…</p>}
        {!catalogError && !catalogLoading && <p className="pos-catalog-count" role="status">{search.trim() ? visibleCatalog.length ? `“${search.trim()}”: ${visibleCatalog.length} ta mos taom yuqorida. Barcha ${terminal.catalog.length} ta mahsulot ko‘rsatilmoqda.` : `“${search.trim()}” topilmadi. Barcha ${terminal.catalog.length} ta mahsulot quyida ko‘rinib turibdi.` : `Barcha ${terminal.catalog.length} ta mahsulot`}</p>}
        <div className="pos-category-list">
          {catalogGroups.map(({ items, ...category }) => {
            return <section key={category.id}><h2>{category.name}</h2><div>{items.map((item) => <button type="button" disabled={busy || (isDelivery && !item.salePrice)} className={`${cart[item.id] ? "selected" : ""}${searchMatchIds.has(item.id) ? " pos-search-match" : ""}`} key={item.id} onClick={() => setQuantity(item.id, Number(cart[item.id] || 0) + 1)}><span><strong>{item.name}</strong><small>{item.posCode ? `${item.posCode} · ` : ""}{isDelivery&&!item.salePrice?'Delivery narxi yo‘q — rahbar belgilaydi':won(item.salePrice)}</small></span><b>{cart[item.id] ? `×${cart[item.id]}` : "+"}</b></button>)}</div></section>;
          })}
          {!terminal.catalog.length && !catalogError && !catalogLoading && <div className="pos-catalog-message"><strong>Bu filialda menyu mahsulotlari hali yo‘q</strong><p>Rahbar menyusida shu filialning taomlarini tekshiring.</p><button type="button" onClick={() => void refreshTerminal(false, branchId)}>Qayta yuklash</button></div>}
        </div>
      </section>

      <aside className="pos-cart-panel">
        <div className="pos-panel-title"><span><small>02 · HISOB</small><h2>{isDelivery?`${deliveryPlatformShortLabel(deliveryPlatform)} · DELIVERY`:'Joriy yozuv'}</h2></span><b>{cartQuantity} ta</b></div>
        <label className="pos-entry-date"><span>Hisob sanasi</span><input type="date" aria-label="Hisob sanasi" value={entryDate || seoulBusinessDate(new Date())} max={seoulBusinessDate(new Date())} disabled={busy || Boolean(editingRecord)} onChange={event => { pendingOperationId.current = ""; setEntryDate(event.target.value); }} /><small>{entryDate && entryDate !== seoulBusinessDate(new Date()) ? `Yozuv ${entryDate} sanasidagi hisobotga qo‘shiladi.` : "Bugungi hisobotga qo‘shiladi. Kerak bo‘lsa sanani o‘zgartiring."}</small></label>
        {editingRecord && <div className="pos-editing-banner"><span><b>TAHRIRLASH REJIMI</b><small>Sotilgan/yeyilgan vaqt o‘zgarmaydi; hisob va ombor qayta hisoblanadi.</small></span><button type="button" onClick={cancelEditing}>BEKOR QILISH</button></div>}
        <div className="pos-cart-lines">
          {cartItems.length ? cartItems.map((item) => <article key={item.id}>
            <span><strong>{item.name}</strong><small>{won(item.salePrice)} × {item.quantity}</small></span>
            <div><button type="button" onClick={() => setQuantity(item.id, item.quantity - 1)}>−</button><b>{item.quantity}</b><button type="button" onClick={() => setQuantity(item.id, item.quantity + 1)}>+</button></div>
            <em>{won(item.total)}</em>
          </article>) : <p className="pos-empty">Chap tomondan taom tanlang.</p>}
        </div>
        {isDelivery && <p className="pos-notice">Xodim faqat sana va sotilgan mahsulot sonini kiritadi. Ushlanma foizi, yetkazish puli va chegirma rahbar qoidasidan avtomatik ayriladi.</p>}
        {entryMode === "sale" && <label className="pos-order-note"><span>Izoh</span><input value={note} maxLength={240} onChange={(event) => { pendingOperationId.current = ""; setNote(event.target.value); }} placeholder="Ixtiyoriy izoh" /></label>}
        {!lockMode && !isDelivery && <div className="pos-entry-mode" role="group" aria-label="Yozuv rejimi"><button type="button" className={entryMode === "sale" ? "active" : ""} onClick={() => { pendingOperationId.current = ""; setEditingRecord(null); setCart({}); setEntryMode("sale"); setPaymentType(initialPaymentType); }}><b>NAQD / HISOB-RAQAM SAVDOSI</b><small>Daromad va omborga yoziladi · soliq ulanmaydi</small></button><button type="button" className={entryMode === "inventory_only" ? "active" : ""} onClick={() => { pendingOperationId.current = ""; setEditingRecord(null); setCart({}); setEntryMode("inventory_only"); setInventoryReason(inventoryReasons[0] || inventoryOutflowReasons[0]); setNote(""); }}><b>{inventoryModeTitle}</b><small>{inventoryModeHelp}</small></button></div>}
        {entryMode === "sale" ? isDelivery ? <p className="pos-notice">Delivery savdosi alohida hisobga yoziladi. Jami summani platformadagi buyurtma bilan solishtiring.</p> : <div className={`pos-payment-choice choices-${salePaymentOptions.length}`}>{salePaymentOptions.includes("cash") && <button type="button" className={paymentType === "cash" ? "active" : ""} onClick={() => { pendingOperationId.current = ""; setPaymentType("cash"); }}><i>₩</i><span><b>Naqd</b><small>Soliq avtomatik ajratilmaydi</small></span></button>}{salePaymentOptions.includes("bank") && <button type="button" className={paymentType === "bank" ? "active" : ""} onClick={() => { pendingOperationId.current = ""; setPaymentType("bank"); }}><i>↗</i><span><b>Hisob-raqam</b><small>Soliq avtomatik ajratilmaydi</small></span></button>}{salePaymentOptions.includes("card") && <button type="button" className={paymentType === "card" ? "active" : ""} onClick={() => { pendingOperationId.current = ""; setPaymentType("card"); }}><i>▣</i><span><b>Karta</b><small>POS savdo hisobi</small></span></button>}</div>
          : <div className="pos-inventory-only">{inventoryReasons.length > 1 && <label><span>Ombordan minus sababi</span><select value={inventoryReason} onChange={(event) => { pendingOperationId.current = ""; setInventoryReason(event.target.value); }}>{inventoryReasons.map((reason) => <option value={reason} key={reason}>{reason}</option>)}</select></label>}<p><b>Diqqat:</b> bu amal pul tushumi yaratmaydi; tanlangan taom retsepti ombordan ayriladi. Mijoz pul to‘lagan bo‘lsa “Naqd / hisob-raqam savdosi” rejimidan foydalaning.</p></div>}
        <div className="pos-cart-total"><span>{entryMode === "sale" ? "Jami" : "Ombordan ayriladi"}</span><strong>{entryMode === "sale" ? won(cartTotal) : `${cartQuantity} porsiya`}</strong></div>
        {needsLogin && <p className="pos-notice"><a href="/">Rahbar sifatida kirish</a> · <a href="/worker">Xodim sifatida kirish</a></p>}
        {notice && <p className={notice.startsWith("✓") ? "pos-notice success" : "pos-notice"}>{notice}</p>}
        <button className="pos-save-order" type="button" disabled={busy || !cartItems.length || (isDelivery && (!deliveryPlatform || cartItems.some(i=>!i.salePrice)))} onClick={() => void saveOrder()}>{busy ? "Saqlanmoqda…" : editingRecord ? "O‘ZGARISHNI SAQLASH VA QAYTA HISOBLASH" : entryMode === "sale" ? isDelivery ? `${deliveryPlatformShortLabel(deliveryPlatform)} · DELIVERYNI SAQLASH` : "Savdoni saqlash" : "Ovqatni ombordan ayirish"}</button>
      </aside>

      {!terminal.publicEntry && <section className="pos-orders-panel pos-record-history">
        <div className="pos-panel-title"><span><small>03 · SAQLANGAN YOZUVLAR</small><h2>Savdo va oshxonada yeyilgan ovqatlar tarixi</h2></span><b>{visibleSales.length + visibleInventoryOutflows.length} yozuv</b></div>
        <div className="pos-record-columns">
          <section>
            <header><span><b>{isDelivery?'Delivery savdolari':'Naqd va hisob-raqam savdosi'}</b><small>Sotilgan taomlar va tushum</small></span><strong>{visibleSales.length}</strong></header>
            <div className="pos-sale-list">{visibleSales.length ? visibleSales.map((order) => <article key={order.id}>
              <header><b className={order.paymentType}>{order.paymentType === "delivery" ? `${deliveryPlatformShortLabel(order.deliveryPlatform)} · ${order.deliveryOrderNumber}` : order.paymentType === "bank" ? "HISOB-RAQAM" : order.paymentType === "card" ? "KARTA" : "NAQD"}</b><time>Savdo sanasi · {order.date}<br/>Kiritilgan · {recordDateTime(order.createdAt)}</time><strong>{won(order.total)}</strong></header>
              <div>{order.items.map((item) => <span key={item.id}><b>{item.quantity}×</b><em>{item.name}</em><strong>{won(item.total)}</strong></span>)}</div>
              {order.note && <small>{order.note}</small>}
              {order.editedAt && <small className="pos-edited-time">Tahrirlangan · {recordDateTime(order.editedAt)}</small>}
              {order.editable !== false && <footer className="pos-record-actions"><button type="button" disabled={Boolean(actionBusyId)} onClick={() => editSale(order)}>TAHRIRLASH</button><button type="button" className="danger" disabled={Boolean(actionBusyId)} onClick={() => void deleteRecord({ id: order.id, type: "sale" })}>{actionBusyId === order.id ? "O‘CHIRILMOQDA…" : "O‘CHIRISH"}</button></footer>}
            </article>) : <p className="pos-empty">Naqd yoki hisob-raqam savdosi hali kiritilmagan.</p>}</div>
          </section>
          {showOutflowHistory && <section>
            <header><span><b>Oshxonada yeyilgan ovqatlar</b><small>Ombordan ayrilgan taomlar</small></span><strong>{visibleInventoryOutflows.length}</strong></header>
            <div className="pos-meal-list">{visibleInventoryOutflows.length ? visibleInventoryOutflows.map((entry) => <article key={entry.id}>
              <header><span><strong>{entry.label}</strong><small>{entry.items?.length ? entry.items.map((item) => `${item.name} × ${item.quantity}`).join(", ") : entry.reason}</small></span><b>{entry.quantity} {entry.unit}</b></header>
              <footer><span>Hisob sanasi · {entry.date}</span><time>Kiritilgan · {recordDateTime(entry.createdAt)}</time></footer>
              {entry.editedAt && <small className="pos-edited-time">Tahrirlangan · {recordDateTime(entry.editedAt)}</small>}
              {entry.editable && <footer className="pos-record-actions"><button type="button" disabled={Boolean(actionBusyId)} onClick={() => editInventoryOutflow(entry)}>TAHRIRLASH</button><button type="button" className="danger" disabled={Boolean(actionBusyId)} onClick={() => void deleteRecord({ id: entry.id, type: "inventory_only" })}>{actionBusyId === entry.id ? "O‘CHIRILMOQDA…" : "O‘CHIRISH"}</button></footer>}
            </article>) : <p className="pos-empty">Oshxonada yeyilgan ovqat hali kiritilmagan.</p>}</div>
          </section>}
        </div>
      </section>}
    </div>
  </main>;
}

export default function PosTerminalPage() {
  return <PosTerminalScreen
    initialMode="sale"
    initialPaymentType="cash"
    salePaymentOptions={["cash", "bank"]}
    inventoryReasons={["Oshxonada yeyilgan ovqat"]}
    inventoryModeTitle="OSHXONADA YEYILGAN OVQAT"
    inventoryModeHelp="Daromadsiz, faqat ombordan minus"
    terminalSubtitle="Naqd, hisob-raqam va oshxona ovqati"
  />;
}
