import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

// Создаем обертку плагина
const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  output: 'standalone',
  productionBrowserSourceMaps: false,
};

export default withNextIntl(nextConfig);