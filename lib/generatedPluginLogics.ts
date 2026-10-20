// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import { pluginManager } from './pluginManager';

import * as my_super_plugin_logic from '../plugins/my_super_plugin/frontend/logic';

/**
 * Инициализирует логику всех плагинов.
 * Должна быть вызвана один раз при старте приложения (например, в layout.tsx или _app.tsx).
 */
export function initializePluginLogics() {
  pluginManager.registerLogic('my_super_plugin', my_super_plugin_logic);
  if (typeof (my_super_plugin_logic as any).init === 'function') (my_super_plugin_logic as any).init();
}
