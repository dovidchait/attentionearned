// @ts-check
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

const UNLISTED_SLUGS = [
  'cinematography-work-samples',
  'how-does-a-16-year-old-inspire-real-change',
  'nonprofit',
  'team',
  'lifestyle',
  'mazeltov',
  'testimonials',
  'talking-head-reel',
  'creative-work-samples',
  'giving',
  'event',
  'headshots',
  'micro-videos',
  'work-samples',
];

// https://astro.build/config
export default defineConfig({
  site: 'https://attentionearned.com',
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !UNLISTED_SLUGS.some((slug) => page.endsWith(`/${slug}/`) || page.endsWith(`/${slug}`)),
    }),
  ],
  adapter: vercel(),
  output: 'static',
});
