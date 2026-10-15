import { z } from 'zod';

/**
 * Request schemas for storefront routes, same `{ body, params, query }`
 * shape as 11xsales-be. Shared building blocks live at the top.
 */
export const paginationQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});

export const agentProfileSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});

export const chatDesignSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}).optional(),
  query: z.object({}).optional(),
});
