// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import dynamic from 'next/dynamic';

const PageComponent = dynamic(() => import('../../../plugins/my_super_plugin/frontend/pages/index'), {
    loading: () => <div style={{ padding: '2rem', textAlign: 'center' }}>Загрузка страницы плагина...</div>,
    ssr: true,
});

export default function Page() {
    return <PageComponent />;
}
