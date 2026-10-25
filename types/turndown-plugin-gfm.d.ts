// turndown-plugin-gfm.d.ts

declare module 'turndown-plugin-gfm' {
  // Объявляем экспорты как any, чтобы TypeScript не ругался, 
  // но при этом разрешал импорт { gfm } в вашем коде
  export const gfm: any;
  export const tables: any;
  export const strikethrough: any;
  export const taskListItems: any;
}