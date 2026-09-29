/** Map provider status to safe guidance; never echo provider bodies or credentials. */
export function assistantServiceError(status:number,code:string){
 if(code==='credit_balance_exhausted')return 'AI hisobida mablag‘ qolmagan. OpenAI Platform → Settings → Billing → Add credits orqali balansni to‘ldiring: https://platform.openai.com/settings/organization/billing/overview . Keyin savolingizni qayta yuboring. Bu savolingiz tushunarsizligi emas. Hech narsa saqlanmadi.';
 if(code==='organization_spend_limit_exceeded'||code==='project_spend_limit_exceeded')return 'OpenAI API sarf chegarasiga yetgan. Platformadagi tashkilot yoki loyiha limitini tekshiring. Hech narsa saqlanmadi.';
 if(code==='organization_usage_limit_exceeded')return 'OpenAI API foydalanish limitiga yetgan. OpenAI Platformdagi Limits bo‘limini tekshiring. Hech narsa saqlanmadi.';
 if(code==='insufficient_quota'||code==='billing_hard_limit_reached')return 'OpenAI API balansi yoki sarf limiti tugagan. OpenAI Platform → Billing bo‘limini tekshiring. Oddiy yetkazuvchi ro‘yxati, Qarzlar va Ombor AI siz ham ishlaydi. Hech narsa saqlanmadi.';
 if(status===401)return 'OpenAI API kaliti qabul qilinmadi. Sayt sozlamasidagi OPENAI_API_KEY ni tekshirish kerak. Kalitni chatga yubormang. Hech narsa saqlanmadi.';
 if(status===403)return 'OpenAI API ushbu so‘rovga ruxsat bermadi. API loyihasi va model ruxsatlarini tekshirish kerak. Hech narsa saqlanmadi.';
 if(status===429)return 'AI so‘rovlari vaqtincha limitga yetdi. Birozdan keyin qayta urinib ko‘ring. Oddiy yetkazuvchi ro‘yxati, Qarzlar va Ombor ishlaydi. Hech narsa saqlanmadi.';
 if(status===400||status===404)return `AI sozlamasi yoki so‘rov formati qabul qilinmadi (${status}). Bu sizning yozishingizdagi xato emas. Hech narsa saqlanmadi.`;
 return 'AI bilan ulanish vaqtincha ishlamadi. Oddiy yetkazuvchi ro‘yxati, Qarzlar va Ombor ishlaydi. Hech narsa saqlanmadi; keyin qayta urinib ko‘ring.';
}
