import { createRequire } from 'module';

let _cachedExcelJS: any = null;

/**
 * Loads ExcelJS using the bare bundle to prevent module resolution hangs
 * caused by fast-csv / stream loops in the default exceljs Node.js entrypoint.
 */
export function getExcelJS(): any {
  if (!_cachedExcelJS) {
    const req = createRequire(typeof import.meta !== 'undefined' && import.meta.url ? import.meta.url : __filename);
    _cachedExcelJS = req('exceljs/dist/exceljs.bare.js');
  }
  return _cachedExcelJS;
}
