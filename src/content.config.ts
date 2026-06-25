import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const work = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/work' }),
  schema: z.object({
    title: z.string(),
    client: z.string().optional(),
    sector: z.enum(['corporate', 'healthcare', 'nonprofit', 'film', 'brand']),
    summary: z.string(),
    video: z.object({
      provider: z.enum(['swarmify', 'youtube', 'vimeo']),
      src: z.string(),
      poster: z.string().optional(),
    }).optional(),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

const services = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/services' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    icon: z.string().optional(),
    order: z.number().default(0),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
  }),
});

export const collections = { work, services, pages };
