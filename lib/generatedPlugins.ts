// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import dynamic from 'next/dynamic';

const my_super_plugin_cartpromowidget = dynamic(() => import('../plugins/my_super_plugin/frontend/index'));

export const pluginComponents: Record<string, { component: any; plugin: string }> = {
  'cart-promo-widget': { component: my_super_plugin_cartpromowidget, plugin: 'my_super_plugin' },
};
