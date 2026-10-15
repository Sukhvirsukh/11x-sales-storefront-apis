import { FastifyReply, FastifyRequest } from 'fastify';
import { AnyZodObject, ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';

/**
 * Generic request-validation preHandler — same contract as 11xsales-be's
 * `validate`: pass a Zod schema shaped like `{ body?, params?, query? }`
 * and it validates + replaces `req.<part>` with the parsed (and
 * type-coerced) result before the controller runs.
 * Usage: `preHandler: [validate(schema)]`.
 */
export const validate =
  (schema: AnyZodObject) =>
  async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    try {
      const parsed = schema.parse({ body: req.body, params: req.params, query: req.query });
      if (parsed.body) req.body = parsed.body;
      if (parsed.params) req.params = parsed.params;
      if (parsed.query) req.query = parsed.query;
    } catch (err) {
      if (err instanceof ZodError) {
        const details = err.errors.map((e) => ({
          field: e.path.slice(1).join('.'), // drop the leading body/params/query segment
          message: e.message,
        }));
        throw ApiError.badRequest('Validation failed', details);
      }
      throw err;
    }
  };
