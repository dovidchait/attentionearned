import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const work = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/work' }),
  schema: z.object({
    title: z.string(),
    client: z.string().optional(),
    sector: z.enum([
      'corporate',
      'healthcare',
      'nonprofit',
      'film',
      'music-video',
      'commercial',
      'fashion',
      'behind-the-scenes',
    ]),
    summary: z.string(),
    video: z.object({
      provider: z.enum(['swarmify', 'youtube', 'vimeo']),
      src: z.string(),
      poster: z.string().optional(),
    }).optional(),
    credits: z.array(z.string()).optional(),
    date: z.coerce.date().optional(),
    featured: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

const services = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/services' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    problem: z.string(),
    note: z.string().optional(),
    produces: z.array(z.string()),
    specialties: z.array(z.string()),
    sectors: z.array(z.string()).default([]),
    heroType: z.enum(['video', 'iframe', 'placeholder']).default('placeholder'),
    heroSrc: z.string().optional(),
    heroLabel: z.string().optional(),
    beta: z.boolean().default(false),
    order: z.number().default(0),
  }),
});

const pages = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/pages' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    unlisted: z.boolean().default(false),
  }),
});

export const collections = { work, services, pages };
