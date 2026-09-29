"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Recipe = { id: string; name: string; salePrice: number };
type ApiPermission = "health:read" | "products:read" | "inventory:read" | "sales:read" | "reports:read" | "export:read" | "sales:write" | "refunds:write";
type ApiKeySummary = {
  id: string;
  name: string;
  prefix: string;
  permissions: ApiPermission[];
  active: boolean;
  lastUsedAt: string;
  createdAt: string;
  revokedAt: string;
};
type ProductMapping = {
  id: string;
  externalCode: string;
  externalName: string;
  normalizedName: string;
  recipeId: string;
  createdAt: string;
  updatedAt: string;
};
type IntegrationLog = {
  id: string;
  keyId: string;
  keyName: string;
  endpoint: string;
  method: string;
  status: number;
  externalId: string;
  message: string;
  createdAt: string;
};
type IntegrationSnapshot = {
  keys: ApiKeySummary[];
  activeKeyLimit: number;
  settings: {
    providerName: string;
    storeId: string;
    enabled: boolean;
    updatedAt: string;
  };
  mappings: ProductMapping[];
  logs: IntegrationLog[];
  availablePermissions: ApiPermission[];
};
type CreatedKey = {
  id: string;
  key: string;
  prefix: string;
  permissions: ApiPermission[];
  createdAt: string;
};
type TelegramPublicSettings = {
  configured?: boolean;
  tokenSaved?: boolean;
  botName?: string;
  enabled?: boolean;
};

const permissionLabels: Record<ApiPermission, string> = {
  "health:read": "Ulanishni tekshirish",
  "products:read": "Taomlarni o‘qish",
  "inventory:read": "Omborni o‘qish",
  "sales:read": "Savdoni o‘qish",
  "reports:read": "Hisobotni o‘qish",
  "export:read": "To‘liq eksport",
  "sales:write": "Savdoni yozish",
  "refunds:write": "Bekor qilish",
};
const allPermissions: ApiPermission[] = ["health:read", "products:read", "inventory:read", "sales:read", "reports:read", "export:read", "sales:write", "refunds:write"];
const defaultPermissions: ApiPermission[] = allPermissions.filter((permission) => permission !== "export:read");

export default function IntegrationCenter({ recipes, branchId }: { recipes: Recipe[]; branchId: string }) {
  const actionInFlight = useRef(false);
  const [snapshot, setSnapshot] = useState<IntegrationSnapshot | null>(null);
  const [telegram, setTelegram] = useState<TelegramPublicSettings>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [createdKey, setCreatedKey] = useState<CreatedKey | null>(null);
  const [googleSheetsKey, setGoogleSheetsKey] = useState<CreatedKey | null>(null);
  const [googleSheetsScript, setGoogleSheetsScript] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [keyName, setKeyName] = useState("Asosiy integratsiya");
  const [permissions, setPermissions] = useState<ApiPermission[]>(defaultPermissions);
  const [settingsForm, setSettingsForm] = useState({ providerName: "", storeId: "", enabled: false });
  const [mappingForm, setMappingForm] = useState({ externalCode: "", externalName: "", recipeId: "" });
  const [origin] = useState(() => typeof window === "undefined" ? "" : window.location.origin);

  const load = async () => {
    setLoading(true);
    try {
      const [integrationResponse, telegramResponse] = await Promise.all([
        fetch(`/api/admin/integrations?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" }),
        fetch(`/api/telegram?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" }),
      ]);
      const integration = await integrationResponse.json() as IntegrationSnapshot & { error?: string };
      const telegramValue = await telegramResponse.json() as TelegramPublicSettings;
      if (!integrationResponse.ok) throw new Error(integration.error || "Sozlamalar ochilmadi.");
      setSnapshot(integration);
      setSettingsForm(integration.settings);
      setTelegram(telegramValue);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sozlamalar ochilmadi.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`/api/admin/integrations?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" }),
      fetch(`/api/telegram?branch=${encodeURIComponent(branchId)}`, { cache: "no-store" }),
    ]).then(async ([integrationResponse, telegramResponse]) => {
      const integration = await integrationResponse.json() as IntegrationSnapshot & { error?: string };
      const telegramValue = await telegramResponse.json() as TelegramPublicSettings;
      if (!integrationResponse.ok) throw new Error(integration.error || "Sozlamalar ochilmadi.");
      if (!active) return;
      setSnapshot(integration);
      setSettingsForm(integration.settings);
      setTelegram(telegramValue);
    }).catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : "Sozlamalar ochilmadi.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [branchId]);

  const apiAction = async (body: Record<string, unknown>, actionName: string) => {
    if (actionInFlight.current) return null;
    actionInFlight.current = true;
    setBusy(actionName);
    setNotice("");
    try {
      const response = await fetch("/api/admin/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, branchId }),
      });
      const result = await response.json() as IntegrationSnapshot & { error?: string; createdKey?: CreatedKey; googleSheetsScript?: string };
      if (!response.ok) throw new Error(result.error || "Amal bajarilmadi.");
      setSnapshot(result);
      setSettingsForm(result.settings);
      if (result.createdKey && body.action !== "setup-google-sheets") setCreatedKey(result.createdKey);
      setNotice("✓ Saqlandi");
      return result;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Amal bajarilmadi.");
      return null;
    } finally {
      actionInFlight.current = false;
      setBusy("");
    }
  };

  const generateKey = async () => {
    const saved = await apiAction({ action: "generate-key", name: keyName, permissions }, "generate");
    if (saved) setKeyName("Yangi integratsiya");
  };
  const saveSettings = () => apiAction({ action: "save-settings", ...settingsForm }, "settings");
  const saveMapping = async () => {
    const saved = await apiAction({ action: "save-mapping", ...mappingForm }, "mapping");
    if (saved) setMappingForm({ externalCode: "", externalName: "", recipeId: "" });
  };
  const revokeKey = (keyId: string, name: string) => {
    if (!window.confirm(`${name} API kalitini bekor qilasizmi? U darhol ishlamay qoladi.`)) return;
    void apiAction({ action: "revoke-key", keyId }, `revoke-${keyId}`);
  };
  const deleteMapping = (mappingId: string) => {
    void apiAction({ action: "delete-mapping", mappingId }, `mapping-${mappingId}`);
  };
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`✓ ${label} nusxalandi`);
    } catch {
      setNotice(`${label}ni belgilab, qo‘lda nusxalang.`);
    }
  };
  const setupGoogleSheets = async () => {
    const result = await apiAction({ action: "setup-google-sheets" }, "google-sheets");
    if (result?.createdKey) {
      setGoogleSheetsKey(result.createdKey);
      setGoogleSheetsScript(result.googleSheetsScript || "");
      setNotice("✓ Google Sheets ulash kodi tayyor");
    }
  };
  const downloadBackup = async () => {
    setBusy("backup");
    setNotice("");
    try {
      const response = await fetch(`/api/backups?branch=${encodeURIComponent(branchId)}&download=current`, { cache: "no-store" });
      const state = await response.json();
      if (!response.ok) throw new Error("Backup ma’lumotlari ochilmadi.");
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `halo-control-${branchId}-backup-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice("✓ To‘liq backup yuklandi");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Backup yuklanmadi.");
    } finally {
      setBusy("");
    }
  };
  const togglePermission = (permission: ApiPermission) => {
    setPermissions((current) => current.includes(permission)
      ? current.filter((item) => item !== permission)
      : [...current, permission]);
  };

  const activeKeys = snapshot?.keys.filter((key) => key.active) || [];
  const keyLimitReached = Boolean(snapshot && activeKeys.length >= snapshot.activeKeyLimit);
  const googleSheetsConnected = activeKeys.some((key) => key.name === "Google Sheets avtomatik hisobot");
  const readiness = useMemo(() => {
    const checks = [
      Boolean(snapshot?.settings.providerName),
      Boolean(snapshot?.settings.storeId),
      Boolean(snapshot?.settings.enabled),
      activeKeys.length > 0,
    ];
    return Math.round(checks.filter(Boolean).length / checks.length * 100);
  }, [activeKeys.length, snapshot]);

  const salesEndpoint = `${origin}/api/pos/v1/sales`;
  const downloadGoogleSheetsScript = () => {
    if (!googleSheetsScript) return;
    const blob = new Blob([googleSheetsScript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "HALO-Google-Sheets.gs";
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("✓ Google Sheets ulash fayli yuklandi");
  };
  const example = `curl -X POST "${salesEndpoint}" \\
  -H "Authorization: Bearer HALO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "orderId": "POS-2026-00001",
    "soldAt": "2026-07-28T22:30:00+09:00",
    "paymentMethod": "card",
    "items": [
      {
        "productCode": "KB-001",
        "productName": "Chicken Kebab",
        "quantity": 2,
        "totalAmount": 19000
      }
    ]
  }'`;

  return (
    <div className="page integration-page">
      <section className="integration-hero">
        <div className="integration-hero-mark">⌁</div>
        <div>
          <span>SOZLAMALAR</span>
          <h2>API va boshqa tizimlar</h2>
          <p>HALO Control ma’lumotlarini boshqa POS, buxgalteriya yoki yangi dasturga xavfsiz ulash va ko‘chirish markazi.</p>
        </div>
        <div className="integration-readiness">
          <small>Ulanishga tayyorlik</small>
          <strong>{loading ? "…" : `${readiness}%`}</strong>
          <i><b style={{ width: `${readiness}%` }} /></i>
        </div>
      </section>

      {notice && <p className={notice.startsWith("✓") ? "integration-notice success" : "integration-notice"}>{notice}</p>}

      <section className="integration-health-grid">
        <article className="good"><i>✓</i><span><b>Ma’lumotlar</b><small>Xavfsiz saqlanmoqda</small></span></article>
        <article className={snapshot?.settings.enabled ? "good" : "warning"}><i>{snapshot?.settings.enabled ? "✓" : "1"}</i><span><b>API ulanishi</b><small>{snapshot?.settings.enabled ? "Ishlayapti" : "Hali yoqilmagan"}</small></span></article>
        <article className={activeKeys.length ? "good" : "warning"}><i>{activeKeys.length ? "✓" : "2"}</i><span><b>Ulash kaliti</b><small>{activeKeys.length ? "Tayyor" : "Yaratilmagan"}</small></span></article>
        <article className={snapshot?.mappings.length ? "good" : "warning"}><i>{snapshot?.mappings.length ? "✓" : "3"}</i><span><b>Mahsulotlar</b><small>{snapshot?.mappings.length ? `${snapshot.mappings.length} ta bog‘langan` : "Bog‘lanmagan"}</small></span></article>
      </section>

      <button className="advanced-toggle" onClick={() => setShowAdvanced((current) => !current)}>
        {showAdvanced ? "Oddiy ko‘rinishga qaytish" : "Texnik sozlamalarni ko‘rsatish"}
        <span>{showAdvanced ? "↑" : "↓"}</span>
      </button>

      <div className={`integration-layout ${showAdvanced ? "" : "simple"}`}>
        <div className="integration-main">
          <section className="integration-card google-sheets-card">
            <div className="integration-card-head">
              <div><span>GOOGLE SHEETS · BITTA SANA OYNASI</span><h3>Bitta oynadan kunlik yoki davriy hisobotni tanlang</h3><p>“HALO HISOBOT” B2 va B3 kataklaridan sanani tanlang. Bitta kun uchun ikkala sanani bir xil qo‘ying; barcha 9 ta hisobot, jumladan HALO DELIVERY, shu davr bo‘yicha avtomatik yangilanadi.</p></div>
              <b className={googleSheetsKey ? "enabled" : ""}>{googleSheetsKey ? "KOD TAYYOR" : "1 MARTA ULASH"}</b>
            </div>

            {!googleSheetsKey ? <div className="sheets-create">
              <div className="sheets-tabs">
                <span>Hisobot</span><span>Kunlik</span><span>Savdo</span><span>Pul harakati</span><span>Ombor</span><span>Sabzavot va sous sarfi</span><span>Chiqim</span><span>Yetkazuvchilar</span><span>Xodimlar</span>
              </div>
              <button onClick={setupGoogleSheets} disabled={Boolean(busy) || keyLimitReached}>
                {busy === "google-sheets" ? "Ulash kodi tayyorlanmoqda…" : googleSheetsConnected ? "Yangi ishlaydigan kod yaratish" : "Google Sheets ulash kodini yaratish"}
              </button>
              <small>Yangi kod tayyor bo‘lguncha oldingi kalit o‘chirilmaydi. Faqat hisobotni o‘qiydigan xavfsiz kalit yaratiladi.</small>
            </div> : <div className="sheets-ready">
              <ol className="sheets-steps">
                <li><b>Google Sheet’ni oching.</b><span>Extensions → Apps Script bo‘limiga kiring.</span></li>
                <li><b>Eski kodning hammasini almashtiring.</b><span>Code.gs ichidagi eski kodni to‘liq o‘chirib, yangi kodni joylang va saqlang.</span></li>
                <li><b>HALO_SETUP’ni bir marta ishga tushiring.</b><span>“HALO ULANISH” oynasida holat ISHLAYAPTI bo‘lsa, eski varaqlar saqlanadi, yangi HALO SABZAVOT SARFI varag‘i qo‘shiladi. 10 ta hisobot, eski varaqlar saqlanadi; keyin hech narsa bosmaysiz. HALO’dagi yangi ma’lumotlar 1 daqiqa ichida avtomatik tushadi.</span></li>
              </ol>
              <div className="sheets-actions">
                <button onClick={() => copy(googleSheetsScript, "Apps Script kodi")}>Apps Scriptni nusxalash</button>
                <button className="secondary" onClick={downloadGoogleSheetsScript}>↓ .gs faylni yuklash</button>
              </div>
              <details className="sheets-script-preview"><summary>Ulash kodini ko‘rish</summary><pre>{googleSheetsScript}</pre></details>
              <p className="sheets-key-warning">Mavjud Google Sheets uchun: <a href="/HALO_SABZAVOT_Code.gs" download="HALO_SABZAVOT.gs">Sabzavot qo‘shimcha kodini yuklash</a>. Eski Code.gs saqlanadi; yangi HALO_SABZAVOT fayliga joylang va HALO_SABZAVOT_SETUP’ni bir marta ishga tushiring.</p><p className="sheets-key-warning">“Unauthorized” chiqsa: shu yangi kodni Code.gs ichiga to‘liq qo‘ying, saqlang va HALO_SETUP’ni bir marta ishga tushiring. Oldingi ulanish yangi kod ishlamaguncha avtomatik o‘chirilmaydi.</p>
            </div>}
          </section>

          <section className="integration-card">
            <div className="integration-card-head">
              <div><span>1-QADAM</span><h3>Ulanadigan tizimni belgilang</h3><p>POS, buxgalteriya yoki boshqa dastur nomini kiriting. Har filial alohida ulanadi.</p></div>
              <b className={settingsForm.enabled ? "enabled" : ""}>{settingsForm.enabled ? "API FAOL" : "API O‘CHIQ"}</b>
            </div>
            <div className="integration-settings-form">
              <label><span>Tizim yoki kompaniya nomi</span><input value={settingsForm.providerName} onChange={(event) => setSettingsForm({ ...settingsForm, providerName: event.target.value })} placeholder="Masalan: iMachine POS" /></label>
              <label><span>Tashqi filial ID</span><input value={settingsForm.storeId} onChange={(event) => setSettingsForm({ ...settingsForm, storeId: event.target.value })} placeholder="Tashqi tizim bergan Store ID" /></label>
              <label className="integration-switch"><input type="checkbox" checked={settingsForm.enabled} onChange={(event) => setSettingsForm({ ...settingsForm, enabled: event.target.checked })} /><span><b>HALO API’ni faollashtirish</b><small>Har bir kalit faqat hozirgi filial ma’lumotiga kiradi</small></span></label>
              <button onClick={saveSettings} disabled={busy === "settings"}>{busy === "settings" ? "Saqlanmoqda…" : "Sozlamani saqlash"}</button>
            </div>
          </section>

          <section className="integration-card">
            <div className="integration-card-head">
              <div><span>2-QADAM</span><h3>Ulash kalitini yarating</h3><p>Har bir tashqi dastur uchun alohida kalit yarating va kerakli ruxsatlarnigina tanlang.</p></div>
              <b>{activeKeys.length}/{snapshot?.activeKeyLimit ?? "—"} FAOL</b>
            </div>
            <div className="api-key-create">
              <label><span>Kalit nomi</span><input value={keyName} onChange={(event) => setKeyName(event.target.value)} placeholder="Masalan: HALO buxgalteriya" /></label>
              {showAdvanced && <div className="permission-list">
                {allPermissions.map((permission) => <label key={permission}><input type="checkbox" checked={permissions.includes(permission)} onChange={() => togglePermission(permission)} /><span>{permissionLabels[permission]}</span></label>)}
              </div>}
              <button onClick={generateKey} disabled={Boolean(busy) || !permissions.length || keyLimitReached}>{busy === "generate" ? "Yaratilmoqda…" : "＋ Ulash kalitini yaratish"}</button>
            </div>
            {keyLimitReached && <p className="integration-notice" role="alert">Faol kalitlar chegarasiga yetdingiz. Quyidagi ro‘yxatdan ishlatilmaydigan kalitni bekor qilsangiz, yangisini yaratishingiz mumkin.</p>}

            {createdKey && <div className="new-api-key">
              <div><span>YANGI MAXFIY KALIT</span><h4>Hozir nusxalang — keyin qayta ko‘rinmaydi</h4></div>
              <code>{createdKey.key}</code>
              <div><button onClick={() => copy(createdKey.key, "API kaliti")}>Nusxalash</button><button className="secondary" onClick={() => setCreatedKey(null)}>Yopish</button></div>
            </div>}

            <div className="api-key-list">
              {snapshot?.keys.map((key) => <article className={key.active ? "" : "revoked"} key={key.id}>
                <div className="api-key-title"><i>{key.active ? "●" : "×"}</i><span><strong>{key.name}</strong><small>{key.prefix}</small></span><b>{key.active ? "FAOL" : "BEKOR"}</b></div>
                <div className="api-key-meta"><span>Yaratildi: {key.createdAt ? new Date(key.createdAt).toLocaleDateString("uz-UZ") : "—"}</span><span>Oxirgi ishladi: {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString("uz-UZ") : "Hali ishlamadi"}</span></div>
                {showAdvanced && <div className="api-key-permissions">{key.permissions.map((permission) => <small key={permission}>{permissionLabels[permission]}</small>)}</div>}
                {key.active && <button onClick={() => revokeKey(key.id, key.name)} disabled={Boolean(busy)}>Kalitni bekor qilish</button>}
              </article>)}
              {!snapshot?.keys.length && <p className="integration-empty">Hali API kaliti yaratilmagan.</p>}
            </div>
          </section>

          <section className="integration-card portable-data-card">
            <div className="integration-card-head">
              <div><span>MUSTAQIL MA’LUMOT</span><h3>Tizimni ko‘chirish va zaxiralash</h3><p>ChatGPT yoki hozirgi platforma bo‘lmasa ham, ombor, retsept, savdo, xarajat va hisobotlaringiz standart JSON faylda sizda qoladi.</p></div>
              <b>JSON · API v1</b>
            </div>
            <div className="portable-data-actions">
              <button onClick={downloadBackup} disabled={busy === "backup"}>{busy === "backup" ? "Tayyorlanmoqda…" : "↓ To‘liq ma’lumotni yuklash"}</button>
              <span><b>Filial:</b> {branchId}<small>Faylni boshqa dasturchi yoki yangi tizim to‘g‘ridan-to‘g‘ri o‘qiy oladi.</small></span>
            </div>
          </section>

          <section className="integration-card">
            <div className="integration-card-head">
              <div><span>3-QADAM</span><h3>POS mahsulotlarini retseptga bog‘lang</h3><p>POS kodi yoki POS’dagi nom qaysi HALO retseptiga tegishli ekanini ko‘rsating.</p></div>
              <b>{snapshot?.mappings.length || 0} TA BOG‘LANISH</b>
            </div>
            <div className="mapping-create">
              <label><span>POS mahsulot kodi</span><input value={mappingForm.externalCode} onChange={(event) => setMappingForm({ ...mappingForm, externalCode: event.target.value })} placeholder="KB-001" /></label>
              <label><span>POS’dagi taom nomi</span><input value={mappingForm.externalName} onChange={(event) => setMappingForm({ ...mappingForm, externalName: event.target.value })} placeholder="Chicken Kebab" /></label>
              <label><span>HALO retsepti</span><select value={mappingForm.recipeId} onChange={(event) => setMappingForm({ ...mappingForm, recipeId: event.target.value })}><option value="">Retseptni tanlang</option>{recipes.map((recipe) => <option value={recipe.id} key={recipe.id}>{recipe.name}</option>)}</select></label>
              <button onClick={saveMapping} disabled={busy === "mapping"}>{busy === "mapping" ? "Saqlanmoqda…" : "＋ Bog‘lash"}</button>
            </div>
            <div className="mapping-list">
              {snapshot?.mappings.map((mapping) => <div key={mapping.id}><span><b>{mapping.externalCode || "Kodsiz"}</b><strong>{mapping.externalName || "Nomsiz mahsulot"}</strong></span><i>→</i><span><small>HALO RETSEPTI</small><strong>{recipes.find((recipe) => recipe.id === mapping.recipeId)?.name || "O‘chirilgan retsept"}</strong></span><button onClick={() => deleteMapping(mapping.id)} disabled={busy === `mapping-${mapping.id}`}>×</button></div>)}
              {!snapshot?.mappings.length && <p className="integration-empty">POS mahsulotlari hali bog‘lanmagan.</p>}
            </div>
          </section>

          {showAdvanced && <>
          <section className="integration-card">
            <div className="integration-card-head">
              <div><span>API HUJJATI</span><h3>Boshqa tizimga beriladigan manzillar</h3><p>Har bir so‘rov JSON qaytaradi va API kaliti faqat tanlangan filialga ishlaydi.</p></div>
              <button className="copy-doc-button" onClick={() => copy(example, "API namunasi")}>Namunani nusxalash</button>
            </div>
            <div className="endpoint-list">
              <div><b>GET</b><code>{origin}/api/pos/v1/health</code><span>Ulanishni tekshirish</span></div>
              <div><b>GET</b><code>{origin}/api/pos/v1/products</code><span>HALO taomlari</span></div>
              <div><b>GET</b><code>{origin}/api/integrations/v1/inventory</code><span>Ombor va qoldiq</span></div>
              <div><b>GET</b><code>{origin}/api/integrations/v1/sales</code><span>Savdo tarixi</span></div>
              <div><b>GET</b><code>{origin}/api/integrations/v1/reports</code><span>Kunlik / oylik hisobot</span></div>
              <div><b>GET</b><code>{origin}/api/integrations/v1/google-sheets</code><span>Google Sheets uchun savdo, chiqim va foyda</span></div>
              <div><b>GET</b><code>{origin}/api/integrations/v1/export</code><span>To‘liq ko‘chirish eksporti</span></div>
              <div><b className="post">POST</b><code>{origin}/api/pos/v1/sales</code><span>Savdo yuborish</span></div>
              <div><b className="post">POST</b><code>{origin}/api/pos/v1/refunds</code><span>Bekor qilish</span></div>
            </div>
            <pre className="api-example">{example}</pre>
            <div className="api-security-note"><i>🔒</i><span><b>Filial bo‘yicha himoya</b><small>Kalitning o‘zi bazada saqlanmaydi, faqat xavfsiz xeshi saqlanadi. Har bir kalit faqat yaratilgan filial va tanlangan ruxsatlar bilan ishlaydi.</small></span></div>
          </section>

          <section className="integration-card">
            <div className="integration-card-head">
              <div><span>NAZORAT JURNALI</span><h3>Oxirgi API harakatlari</h3><p>Muvaffaqiyatli va xato so‘rovlar shu yerda qoladi.</p></div>
              <button className="copy-doc-button" onClick={load}>Yangilash</button>
            </div>
            <div className="integration-log-list">
              {snapshot?.logs.map((log) => <div key={log.id}><b className={log.status >= 400 ? "error" : "ok"}>{log.status}</b><span><strong>{log.method} {log.endpoint}</strong><small>{log.keyName} · {log.externalId || "ID yo‘q"}</small></span><span><strong>{log.message || "—"}</strong><small>{new Date(log.createdAt).toLocaleString("uz-UZ")}</small></span></div>)}
              {!snapshot?.logs.length && <p className="integration-empty">API hali ishlatilmagan.</p>}
            </div>
          </section>
          </>}
        </div>

        {showAdvanced && <aside className="integration-side">
          <section className="integration-card sticky">
            <div className="integration-card-head compact"><div><span>XAVFSIZLIK</span><h3>Kalitlar holati</h3></div></div>
            <div className="secret-status-list">
              <div><i className={activeKeys.length ? "good" : ""} /><span><b>HALO API</b><small>{activeKeys.length ? `${activeKeys.length} ta faol kalit` : "Kalit yaratilmagan"}</small></span></div>
              <div><i className={telegram.tokenSaved ? "good" : ""} /><span><b>Telegram Bot</b><small>{telegram.tokenSaved ? `${telegram.botName || "Token"} xavfsiz saqlangan` : "Ulanmagan"}</small></span></div>
              <div><i className="good" /><span><b>Admin kirishi</b><small>Faqat rahbar akkaunti</small></span></div>
              <div><i className="good" /><span><b>Ko‘chirish eksporti</b><small>Standart JSON format tayyor</small></span></div>
            </div>
            <div className="integration-rule"><b>Kalit qoidasi</b><p>Kalitni Telegram yoki oddiy xabarda hammaga yubormang. Har bir POS uchun alohida kalit yarating va hamkorlik tugasa darhol bekor qiling.</p></div>
            <button className="backup-button" onClick={downloadBackup} disabled={busy === "backup"}>{busy === "backup" ? "Tayyorlanmoqda…" : "↓ To‘liq backup olish"}</button>
            <small className="backup-help">Ombor, savdo, xarajat, retsept va hisoblar JSON faylga yuklanadi.</small>
          </section>
        </aside>}
      </div>
    </div>
  );
}
