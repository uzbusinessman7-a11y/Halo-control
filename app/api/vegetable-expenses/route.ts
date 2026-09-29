import { purchaseReserveReport, saveReserveCount, saveReserveRecipes } from '../../lib/purchase-reserve';
import { isAdminRequest } from '../../lib/integration-store';
import { readHaloState, mutateHaloState, HaloStateConflictError } from '../../lib/halo-store';
import { createVegetableProduct, configureExpenseOnly, vegetableReport, VegetableExpenseError, type VegetablePeriod } from '../../lib/vegetable-expenses';
import { dispatchVegetableNotification } from '../../lib/vegetable-notifications';
import { inventoryTelegramStatus } from '../../lib/inventory-notifications';
import { seoulCalendarDate } from '../../lib/business-time';

export async function GET(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: 'Avval rahbar sifatida kiring.' }, { status: 401 });
  try {
    const url = new URL(request.url), branch = url.searchParams.get('branch') || 'main';
    const period = (url.searchParams.get('period') || 'week') as VegetablePeriod;
    const date = url.searchParams.get('date') || seoulCalendarDate();
    if (!['day', 'week', 'month'].includes(period) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) return Response.json({ error: 'Davr va sanani tekshiring.' }, { status: 400 });
    const { state } = await readHaloState(branch);
    return Response.json({ report: vegetableReport(state, period, date), inventory: state.inventory, suppliers: state.suppliers, accounts: state.accounts,
      startedAt: state.vegetableExpenseStartedAt, settings: state.vegetableExpenseSettings, reserve: purchaseReserveReport(state), reserveCounts: state.purchaseReserveCounts || [],
      telegramConnected: Boolean(await inventoryTelegramStatus(branch)), notifications: state.vegetableNotifications || [] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Sarf hisoboti ochilmadi. Yangilab ko‘ring.' }, { status: 500 }); }
}
export async function POST(request: Request) {
  if (!await isAdminRequest(request)) return Response.json({ error: 'Bu sozlama faqat rahbar uchun.' }, { status: 401 });
  try {
    const branch = new URL(request.url).searchParams.get('branch') || 'main', body = await request.json();
    if (body.action === 'notify') return Response.json({ ok: true, ...await dispatchVegetableNotification(branch) });
    if (!['configure', 'norm', 'reserveCount', 'reserveSettings', 'reserveRecipes', 'createProduct'].includes(body.action)) throw new VegetableExpenseError('Amalni tekshiring.');
    if (body.action === 'configure' && typeof body.enabled !== 'boolean') throw new VegetableExpenseError('Belgini yoqish yoki o‘chirishni tanlang.');
    const norm = Number(body.normPct);
    if (body.action === 'norm' && (body.normPct === '' || body.normPct == null || !Number.isFinite(norm) || norm < 0 || norm > 100)) throw new VegetableExpenseError('Me’yor 0–100% oralig‘ida bo‘lsin.');
    if (body.action === 'reserveSettings' && (typeof body.enabled !== 'boolean' || body.leadDays == null || body.leadDays === '' || !Number.isFinite(Number(body.leadDays)) || Number(body.leadDays) < 0 || Number(body.leadDays) > 14)) throw new VegetableExpenseError('Eslatma vaqti 0–14 kun oralig‘ida bo‘lsin.');
    const mutation = await mutateHaloState<Record<string, unknown>>(state => {
      if (body.action === 'createProduct') return createVegetableProduct(state,body);
      if (body.action === 'reserveRecipes') return saveReserveRecipes(state,body);
      if (body.action === 'reserveCount') return saveReserveCount(state, body, 'Rahbar');
      return { state: body.action === 'configure' ? configureExpenseOnly(state, String(body.inventoryId), body.enabled)
        : body.action === 'reserveSettings' ? { ...state, purchaseReserveSettings: { ...(state.purchaseReserveSettings as object), enabled: body.enabled, leadDays: Number(body.leadDays) } }
        : { ...state, vegetableExpenseSettings: { ...(state.vegetableExpenseSettings as object), normPct: norm } }, result: { saved: true } };
    }, 5, branch, 'Rahbar', body.action === 'createProduct' ? 'Yangi sabzavot yoki sous qo‘shildi' : body.action === 'configure' ? 'Omborsiz xarajat belgisi o‘zgartirildi' : body.action === 'reserveCount' ? 'Alohida zaxira qoldig‘i qayd etildi' : body.action === 'reserveRecipes' ? 'Zaxiraga tegishli menyular tanlandi' : body.action === 'reserveSettings' ? 'Zaxira eslatmasi sozlandi' : 'Sabzavot sarfi me’yori saqlandi', 'Sabzavot va sous');
    return Response.json({ ok: true, ...mutation.result, updatedAt: mutation.updatedAt });
  } catch (error) { return Response.json({ error: error instanceof VegetableExpenseError ? error.message : error instanceof HaloStateConflictError ? 'Boshqa qurilmada o‘zgarish bor. Qayta urinib ko‘ring.' : 'Sozlama saqlanmadi.' }, { status: error instanceof VegetableExpenseError ? 400 : error instanceof HaloStateConflictError ? 409 : 500 }); }
}
