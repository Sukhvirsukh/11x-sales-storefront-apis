import { z } from 'zod';

const cacheKey = z.string().trim().min(3).max(300);

export const invalidateCacheSchema = z.object({
  body: z
    .object({
      keys: z.array(cacheKey).max(1000).optional(),
      // A prefix must be specific (e.g. "agent:<uuid>:") — never a blanket wipe.
      prefixes: z.array(cacheKey.min(8, 'Prefix is too broad')).max(100).optional(),
    })
    .refine((b) => (b.keys?.length ?? 0) + (b.prefixes?.length ?? 0) > 0, {
      message: 'Send at least one key or prefix',
    }),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export type InvalidateCacheInput = z.infer<typeof invalidateCacheSchema>['body'];
