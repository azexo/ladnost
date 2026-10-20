// SPDX-FileCopyrightText: 2026 Andrey Soloduhin
//
// SPDX-License-Identifier: Apache-2.0

import { getRequestConfig } from 'next-intl/server';

export default getRequestConfig(async ({ requestLocale }) => {
  const locale = process.env.NEXT_LOCALE || 'ru';

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});