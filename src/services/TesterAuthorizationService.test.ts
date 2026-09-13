import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TesterRepository } from '../data/TesterRepository.js'
import {
  AuthorizationError,
  TesterAuthorizationService,
} from './TesterAuthorizationService.js'

const firstDeviceId = '11111111-1111-4111-8111-111111111111'
const secondDeviceId = '22222222-2222-4222-8222-222222222222'

function expectDenied(operation: () => unknown): void {
  assert.throws(operation, (error) => {
    assert.ok(error instanceof AuthorizationError)
    assert.equal(error.code, 'authorization-denied')
    return true
  })
}

test('registers and idempotently validates an approved device', () => {
  const repository = new TesterRepository(':memory:')
  const service = new TesterAuthorizationService(repository)
  const tester = repository.createTester({ email: 'test@example.com' })
  const input = {
    email: tester.email,
    deviceId: firstDeviceId,
    deviceName: 'Test computer',
  }

  const first = service.register(input)
  const second = service.register(input)

  assert.equal(first.device.id, second.device.id)
  assert.equal(repository.countActiveDevices(tester.id), 1)
  assert.equal(service.validate(input).authorized, true)
  repository.close()
})

test('rejects disabled testers and devices beyond the limit', () => {
  const repository = new TesterRepository(':memory:')
  const service = new TesterAuthorizationService(repository)
  const disabled = repository.createTester({ email: 'disabled@example.com' })
  repository.updateTesterStatus(disabled.id, 'disabled')

  expectDenied(() => service.register({
    email: disabled.email,
    deviceId: firstDeviceId,
    deviceName: 'Disabled device',
  }))

  const tester = repository.createTester({ email: 'active@example.com' })
  service.register({
    email: tester.email,
    deviceId: firstDeviceId,
    deviceName: 'First device',
  })
  expectDenied(() => service.register({
    email: tester.email,
    deviceId: secondDeviceId,
    deviceName: 'Second device',
  }))
  repository.close()
})

test('rejects a device owned by another tester or later revoked', () => {
  const repository = new TesterRepository(':memory:')
  const service = new TesterAuthorizationService(repository)
  const first = repository.createTester({ email: 'first@example.com' })
  const second = repository.createTester({ email: 'second@example.com' })
  const input = {
    email: first.email,
    deviceId: firstDeviceId,
    deviceName: 'Shared device',
  }
  service.register(input)

  expectDenied(() => service.register({ ...input, email: second.email }))
  repository.revokeDevice(firstDeviceId)
  expectDenied(() => service.validate(input))
  repository.close()
})

test('validation updates last seen and persists across repository reopen', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'settingforge-auth-'))
  const databasePath = path.join(directory, 'test.sqlite')
  let repository = new TesterRepository(databasePath)
  const tester = repository.createTester({ email: 'persist@example.com' })
  const input = {
    email: tester.email,
    deviceId: firstDeviceId,
    deviceName: 'Persistent device',
  }
  const registered = new TesterAuthorizationService(repository).register(input)
  repository.close()

  await new Promise((resolve) => setTimeout(resolve, 5))
  repository = new TesterRepository(databasePath)
  const validated = new TesterAuthorizationService(repository).validate(input)
  assert.ok(validated.device.lastSeenAt > registered.device.lastSeenAt)
  repository.close()
  rmSync(directory, { recursive: true, force: true })
})
