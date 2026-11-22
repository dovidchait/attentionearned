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
  site: 'https://www.attentionearned.com',
  integrations: [
    mdx(),
    sitemap({
      filter: (page) =>
        !UNLISTED_SLUGS.some((slug) => page.endsWith(`/${slug}/`) || page.endsWith(`/${slug}`)) &&
        !page.includes('/proposals/'),
    }),
  ],
  // Clerk's server build needs these two externals, normally set by @clerk/astro's integration.
  // The integration itself is not used: it injects a Clerk runtime loader into every page,
  // including the public marketing site.
  vite: {
    ssr: { external: ['node:async_hooks'] },
    build: { rollupOptions: { external: ['cloudflare:workers'] } },
  },
  adapter: vercel(),
  output: 'static',
});
