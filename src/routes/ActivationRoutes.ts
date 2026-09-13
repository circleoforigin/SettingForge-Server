import { FastifyInstance, FastifyReply } from 'fastify'
import {
  AuthorizationError,
  DeviceAuthorizationInput,
  TesterAuthorizationService,
} from '../services/TesterAuthorizationService.js'

interface ActivationRouteOptions {
  authorizationService: TesterAuthorizationService
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

interface PublicDeviceAuthorizationResult {
  authorized: true
  deviceId: string
  deviceName: string
  activatedAt: string
  lastSeenAt: string
}

function toPublicResult(
  result: ReturnType<TesterAuthorizationService['validate']>,
): PublicDeviceAuthorizationResult {
  return {
    authorized: true,
    deviceId: result.device.deviceId,
    deviceName: result.device.deviceName,
    activatedAt: result.device.activatedAt,
    lastSeenAt: result.device.lastSeenAt,
  }
}

export async function registerActivationRoutes(
  app: FastifyInstance,
  options: ActivationRouteOptions,
): Promise<void> {
  const rateLimits = new Map<string, RateLimitEntry>()
  const checkRateLimit = (address: string): boolean => {
    const now = Date.now()
    const entry = rateLimits.get(address)
    if (!entry || entry.resetAt <= now) {
      rateLimits.set(address, { count: 1, resetAt: now + 60_000 })
      return true
    }
    entry.count += 1
    return entry.count <= 30
  }

  const handleError = (error: unknown, reply: FastifyReply) => {
    if (error instanceof AuthorizationError) {
      const status = error.code === 'invalid-request' ? 400 : 403
      return reply.code(status).send({ code: error.code, error: error.message })
    }
    app.log.error(error)
    return reply.code(500).send({ code: 'internal-error', error: 'Activation failed.' })
  }

  app.post<{ Body: DeviceAuthorizationInput }>(
    '/activation/register',
    async (request, reply) => {
      if (!checkRateLimit(request.ip)) {
        return reply.code(429).send({
          code: 'rate-limited',
          error: 'Too many activation requests. Try again shortly.',
        })
      }
      try {
        const result = options.authorizationService.register(request.body ?? {})
        return reply.code(200).send(toPublicResult(result))
      } catch (error) {
        return handleError(error, reply)
      }
    },
  )

  app.post<{ Body: DeviceAuthorizationInput }>(
    '/activation/validate',
    async (request, reply) => {
      if (!checkRateLimit(request.ip)) {
        return reply.code(429).send({
          code: 'rate-limited',
          error: 'Too many activation requests. Try again shortly.',
        })
      }
      try {
        const result = options.authorizationService.validate(request.body ?? {})
        return reply.code(200).send(toPublicResult(result))
      } catch (error) {
        return handleError(error, reply)
      }
    },
  )
}
