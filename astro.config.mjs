import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.SITE_URL || 'https://www.autumnlane.cz',
  base: process.env.BASE_PATH || '/',
  output: 'static',
});
