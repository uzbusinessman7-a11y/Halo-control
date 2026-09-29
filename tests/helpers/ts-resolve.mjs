// Sinovlar uchun: ilova kodidagi kengaytmasiz importlarni (./lib/x) .ts faylga yo'naltiradi.
import { registerHooks } from 'node:module';
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier)) return next(`${specifier}.ts`, context);
      throw error;
    }
  },
});
