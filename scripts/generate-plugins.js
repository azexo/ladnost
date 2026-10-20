// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

const fs = require('fs');
const path = require('path');
const pluginsDir = path.join(__dirname, '../plugins');
const uiOutputFile = path.join(__dirname, '../lib/generatedPlugins.ts');
const logicOutputFile = path.join(__dirname, '../lib/generatedPluginLogics.ts');
const appOutputDir = path.join(__dirname, '../app/(plugins)');

// Функция для создания валидного JS-идентификатора
function sanitizeIdentifier(str) {
    let sanitized = str.replace(/[^a-zA-Z0-9_]/g, '');
    if (/^[0-9]/.test(sanitized)) {
        sanitized = '_' + sanitized;
    }
    return sanitized;
}

let uiImports = [];
let uiRegistryEntries = [];
let logicImports = [];
let logicRegistrations = [];

// ==========================================
// ПОДГОТОВКА ПАПКИ ДЛЯ МАРШРУТОВ (APP ROUTER)
// ==========================================
if (fs.existsSync(appOutputDir)) {
    fs.rmSync(appOutputDir, { recursive: true, force: true });
}
fs.mkdirSync(appOutputDir, { recursive: true });

if (fs.existsSync(pluginsDir)) {
    const plugins = fs.readdirSync(pluginsDir);
    plugins.forEach(plugin => {
        const pluginDirPath = path.join(pluginsDir, plugin);
        
        // Пропускаем, если это не папка
        if (!fs.statSync(pluginDirPath).isDirectory()) return;
        
        const manifestPath = path.join(pluginDirPath, 'plugin.json');
        if (!fs.existsSync(manifestPath)) return;
        
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            
            // ==========================================
            // ПРОВЕРКА НА ОТКЛЮЧЕНИЕ ПЛАГИНА
            // ==========================================
            if (manifest.enabled === false || manifest.disabled === true) {
                console.log(`[Plugin Generator] ⏭️ Плагин "${plugin}" отключен в манифесте. Пропускаем генерацию.`);
                return; 
            }
            
            const frontendConfig = manifest.frontend || {};
            const pluginVarName = sanitizeIdentifier(plugin);
            
            // ==========================================
            // 1. ОБРАБОТКА UI КОМПОНЕНТОВ (PluginSlot)
            // ==========================================
            if (frontendConfig.components) {
                Object.entries(frontendConfig.components).forEach(([componentKey, componentPath]) => {
                    const componentVarName = sanitizeIdentifier(componentKey);
                    const importName = `${pluginVarName}_${componentVarName}`;
                    const cleanPath = componentPath.replace(/\.(tsx?|jsx?)$/, '').replace(/^\.\//, '');
                    const relativePath = `../plugins/${plugin}/frontend/${cleanPath}`;
                    
                    uiImports.push(`const ${importName} = dynamic(() => import('${relativePath}'));`);
                    uiRegistryEntries.push(`  '${componentKey}': { component: ${importName}, plugin: '${plugin}' },`);
                });
            }
            
            // ==========================================
            // 2. ОБРАБОТКА ЛОГИКИ / STORE (Хуки и API)
            // ==========================================
            if (frontendConfig.logic) {
                const logicPath = frontendConfig.logic;
                const importName = `${pluginVarName}_logic`;
                const cleanPath = logicPath.replace(/\.(tsx?|jsx?)$/, '').replace(/^\.\//, '');
                const relativePath = `../plugins/${plugin}/frontend/${cleanPath}`;
                
                logicImports.push(`import * as ${importName} from '${relativePath}';`);
                logicRegistrations.push(`  pluginManager.registerLogic('${plugin}', ${importName});`);
                logicRegistrations.push(`  if (typeof (${importName} as any).init === 'function') (${importName} as any).init();`);
            }
            
            // ==========================================
            // 3. ОБРАБОТКА СТРАНИЦ / МАРШРУТОВ (APP ROUTER)
            // ==========================================
            if (frontendConfig.pages) {
                Object.entries(frontendConfig.pages).forEach(([routePath, pageConfig]) => {
                    // Поддержка обратной совместимости: если передана строка, это путь к странице
                    let pageFile, layoutFile;
                    if (typeof pageConfig === 'string') {
                        pageFile = pageConfig;
                    } else if (typeof pageConfig === 'object' && pageConfig !== null && pageConfig.page) {
                        pageFile = pageConfig.page;
                        layoutFile = pageConfig.layout;
                    } else {
                        console.warn(`[Plugin Generator] ⚠️ Неверный формат конфигурации для маршрута ${routePath} в плагине ${plugin}`);
                        return;
                    }

                    // routePath: "/super/[id]" -> normalizedRoute: "super/[id]"
                    const normalizedRoute = routePath.replace(/^\//, ''); 
                    const routeDir = path.join(appOutputDir, normalizedRoute);
                    
                    // Создаем вложенную структуру папок
                    fs.mkdirSync(routeDir, { recursive: true });
                    
                    const cleanPageFile = pageFile.replace(/\.(tsx?|jsx?)$/, '').replace(/^\.\//, '');
                    
                    // Вычисляем абсолютные пути для корректного расчета относительного пути
                    const pageFilePath = path.join(routeDir, 'page.tsx');
                    const targetComponentAbsPath = path.join(__dirname, `../plugins/${plugin}/frontend/${cleanPageFile}`);
                    
                    // Считаем относительный путь от page.tsx до компонента плагина
                    let relativeComponentPath = path.relative(path.dirname(pageFilePath), targetComponentAbsPath).replace(/\\/g, '/');
                    if (!relativeComponentPath.startsWith('.')) {
                        relativeComponentPath = './' + relativeComponentPath;
                    }
                    

                    // Генерация page.tsx
                    const pageContent = `
import dynamic from 'next/dynamic';
const PageComponent = dynamic(() => import('${relativeComponentPath}'), {
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
    </div>
  ),
  ssr: true,
});
export default function Page() {
  return <PageComponent />;
}
`;

                    fs.writeFileSync(pageFilePath, pageContent);
                    console.log(`[Plugin Generator] 📄 Route generated: /${normalizedRoute} (plugin: ${plugin})`);

                    // ==========================================
                    // 3.1 ГЕНЕРАЦИЯ LAYOUT (ЕСЛИ УКАЗАН)
                    // ==========================================
                    if (layoutFile) {
                        const cleanLayoutFile = layoutFile.replace(/\.(tsx?|jsx?)$/, '').replace(/^\.\//, '');
                        const targetLayoutAbsPath = path.join(__dirname, `../plugins/${plugin}/frontend/${cleanLayoutFile}`);
                        const layoutFilePath = path.join(routeDir, 'layout.tsx');
                        
                        let relativeLayoutPath = path.relative(path.dirname(layoutFilePath), targetLayoutAbsPath).replace(/\\/g, '/');
                        if (!relativeLayoutPath.startsWith('.')) {
                            relativeLayoutPath = './' + relativeLayoutPath;
                        }

                        // ✅ СТАЛО (Статический импорт сохраняет Server/Client контекст)
                        const layoutContent = `
import LayoutComponent from '${relativeLayoutPath}';

export default function Layout({ children }: { children: React.ReactNode }) {
    return <LayoutComponent>{children}</LayoutComponent>;
}
`;
                        fs.writeFileSync(layoutFilePath, layoutContent);
                        console.log(`[Plugin Generator] 📄 Layout generated: /${normalizedRoute}/layout.tsx (plugin: ${plugin})`);
                    }

                });
            }
        } catch (e) {
            console.error(`[Plugin Generator] ❌ Error processing plugin ${plugin}:`, e);
        }
    });
}

// ==========================================
// ГЕНЕРАЦИЯ ФАЙЛА ДЛЯ UI (generatedPlugins.ts)
// ==========================================
const uiContent = `
import dynamic from 'next/dynamic';
${uiImports.join('\n')}

export const pluginComponents: Record<string, { component: any; plugin: string }> = {
${uiRegistryEntries.join('\n')}
};
`;
fs.writeFileSync(uiOutputFile, uiContent);
console.log('[Plugin Generator] ✅ Frontend UI registry generated successfully.');

// ==========================================
// ГЕНЕРАЦИЯ ФАЙЛА ДЛЯ ЛОГИКИ (generatedPluginLogics.ts)
// ==========================================
const logicContent = `
import { pluginManager } from './pluginManager';
${logicImports.join('\n')}

/**
 * Инициализирует логику всех плагинов.
 * Должна быть вызвана один раз при старте приложения (например, в layout.tsx или _app.tsx).
 */
export function initializePluginLogics() {
${logicRegistrations.join('\n')}
}
`;
fs.writeFileSync(logicOutputFile, logicContent);
console.log('[Plugin Generator] ✅ Frontend Logic registry generated successfully.');
console.log('[Plugin Generator] 🎉 All plugins processed successfully.');