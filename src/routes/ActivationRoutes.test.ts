import assert from 'node:assert/strict'
import Fastify from 'fastify'
import test from 'node:test'
import { TesterRepository } from '../data/TesterRepository.js'
import { TesterAuthorizationService } from '../services/TesterAuthorizationService.js'
import { registerActivationRoutes } from './ActivationRoutes.js'

const deviceId = '11111111-1111-4111-8111-111111111111'

async function createTestApp() {
  const repository = new TesterRepository(':memory:')
  const authorizationService = new TesterAuthorizationService(repository)
  const app = Fastify()
  await registerActivationRoutes(app, { authorizationService })
  app.addHook('onClose', async () => repository.close())
  return { app, repository }
}

test('activation routes register and validate an approved device', async () => {
  const { app, repository } = await createTestApp()
  repository.createTester({ email: 'route@example.com' })
  const payload = {
    email: 'route@example.com',
    deviceId,
    deviceName: 'Route device',
  }

  const registered = await app.inject({
    method: 'POST',
    url: '/activation/register',
    payload,
  })
  assert.equal(registered.statusCode, 200)
  assert.equal(registered.json().authorized, true)

  const validated = await app.inject({
    method: 'POST',
    url: '/activation/validate',
    payload,
  })
  assert.equal(validated.statusCode, 200)
  assert.equal(validated.json().deviceId, deviceId)
  await app.close()
})

test('activation routes return sanitized denials and validation errors', async () => {
  const { app } = await createTestApp()
  const denied = await app.inject({
    method: 'POST',
    url: '/activation/register',
    payload: {
      email: 'unknown@example.com',
      deviceId,
      deviceName: 'Unknown device',
    },
  })
  assert.equal(denied.statusCode, 403)
  assert.deepEqual(denied.json(), {
    code: 'authorization-denied',
    error: 'This tester or device is not authorized.',
  })

  const invalid = await app.inject({
    method: 'POST',
    url: '/activation/validate',
    payload: { email: 'bad', deviceId: 'bad' },
  })
  assert.equal(invalid.statusCode, 400)
  assert.equal(invalid.json().code, 'invalid-request')
  await app.close()
})
