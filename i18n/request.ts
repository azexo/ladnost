// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = process.env.NEXT_LOCALE || 'ru';

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});