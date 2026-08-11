import type { Request, Response, NextFunction } from 'express'
import { z, ZodError } from 'zod'

type ValidateTarget = 'body' | 'query' | 'params'

function formatZodError(err: ZodError): { error: string; details: Record<string, string[]> } {
  const flattened = err.flatten()
  const details: Record<string, string[]> = {}

  for (const [key, messages] of Object.entries(flattened.fieldErrors)) {
    if (messages) details[key] = messages as string[]
  }
  if (flattened.formErrors.length > 0) {
    details['_form'] = flattened.formErrors
  }

  // Build a concise top-level message from the first issue
  const firstIssue = err.issues[0]
  const error = firstIssue
    ? `${firstIssue.path.join('.') || 'value'}: ${firstIssue.message}`
    : 'Validation failed'

  return { error, details }
}

/**
 * Validate `req[target]` against a Zod schema.
 * On success, replaces `req[target]` with the parsed (coerced/defaulted) value.
 * On failure, responds with 400 { error, details }.
 *
 * Usage:
 *   router.post('/login', validate(loginSchema), handler)
 *   router.get('/users', validate(authUsersQuerySchema, 'query'), handler)
 *   router.get('/:id', validate(userIdParamSchema, 'params'), handler)
 */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  target: ValidateTarget = 'body',
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = target === 'body' ? req.body : target === 'query' ? req.query : req.params
    const result = schema.safeParse(raw)

    if (!result.success) {
      const { error, details } = formatZodError(result.error)
      res.status(400).json({ error, details })
      return
    }

    // Replace with parsed/coerced value so handlers get typed, defaulted data
    if (target === 'body') {
      req.body = result.data
    } else if (target === 'query') {
      // Express query is read-only getter in some versions; assign via defineProperty fallback
      Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true })
      // Also keep original accessible if needed
      ;(req as unknown as Record<string, unknown>).validatedQuery = result.data
    } else {
      Object.defineProperty(req, 'params', { value: result.data, writable: true, configurable: true })
      ;(req as unknown as Record<string, unknown>).validatedParams = result.data
    }

    next()
  }
}

/**
 * Validate multiple targets at once. Each schema is optional.
 * Responds 400 on first failure.
 */
export function validateMany(schemas: {
  body?: z.ZodTypeAny
  query?: z.ZodTypeAny
  params?: z.ZodTypeAny
}) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const target of ['body', 'query', 'params'] as const) {
      const schema = schemas[target]
      if (!schema) continue

      const raw = target === 'body' ? req.body : target === 'query' ? req.query : req.params
      const result = (schema as z.ZodTypeAny).safeParse(raw)

      if (!result.success) {
        const { error, details } = formatZodError(result.error as ZodError)
        res.status(400).json({ error, details })
        return
      }

      if (target === 'body') {
        req.body = result.data
      } else if (target === 'query') {
        Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true })
        ;(req as unknown as Record<string, unknown>).validatedQuery = result.data
      } else {
        Object.defineProperty(req, 'params', { value: result.data, writable: true, configurable: true })
        ;(req as unknown as Record<string, unknown>).validatedParams = result.data
      }
    }
    next()
  }
}
