import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  TesterDataError,
  TesterRepository,
} from './TesterRepository.js'

function withRepository(
  run: (repository: TesterRepository) => void,
): void {
  const repository = new TesterRepository(':memory:')
  try {
    run(repository)
  } finally {
    repository.close()
  }
}

test('creates an active tester with one device allowed by default', () => {
  withRepository((repository) => {
    const tester = repository.createTester({ email: 'Tester@Example.com' })
    assert.equal(tester.email, 'tester@example.com')
    assert.equal(tester.status, 'active')
    assert.equal(tester.maxDevices, 1)
    assert.deepEqual(repository.listTesters()[0], {
      ...tester,
      devices: [],
    })
  })
})

test('rejects duplicate email addresses case-insensitively', () => {
  withRepository((repository) => {
    repository.createTester({ email: 'tester@example.com' })
    assert.throws(
      () => repository.createTester({ email: 'TESTER@example.com' }),
      (error) => error instanceof TesterDataError &&
        error.code === 'duplicate-email',
    )
  })
})

test('adds a unique device with nullable revokedAt', () => {
  withRepository((repository) => {
    const tester = repository.createTester({ email: 'tester@example.com' })
    const device = repository.addDevice({
      userId: tester.id,
      deviceId: 'fd1aa7c7-962d-42fa-af2b-af6fdd052d50',
      deviceName: 'Theater laptop',
    })
    assert.equal(device.userId, tester.id)
    assert.equal(device.revokedAt, null)
    assert.deepEqual(repository.listTesters()[0]?.devices, [device])
  })
})

test('rejects a duplicate deviceId', () => {
  withRepository((repository) => {
    const first = repository.createTester({ email: 'one@example.com' })
    const second = repository.createTester({ email: 'two@example.com' })
    const deviceId = 'fd1aa7c7-962d-42fa-af2b-af6fdd052d50'
    repository.addDevice({
      userId: first.id,
      deviceId,
      deviceName: 'First laptop',
    })
    assert.throws(
      () => repository.addDevice({
        userId: second.id,
        deviceId,
        deviceName: 'Second laptop',
      }),
      (error) => error instanceof TesterDataError &&
        error.code === 'duplicate-device',
    )
  })
})

test('enforces the device foreign key', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'settingforge-testers-'))
  const filePath = path.join(directory, 'test.sqlite')
  const repository = new TesterRepository(filePath)
  const database = new DatabaseSync(filePath)
  database.exec('PRAGMA foreign_keys = ON')
  try {
    assert.throws(() => database.prepare(`
      INSERT INTO devices (
        id, user_id, device_id, device_name,
        activated_at, last_seen_at, revoked_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'row-id',
      'missing-user',
      'fd1aa7c7-962d-42fa-af2b-af6fdd052d50',
      'Unknown laptop',
      new Date().toISOString(),
      new Date().toISOString(),
      null,
    ), /FOREIGN KEY constraint failed/)
  } finally {
    database.close()
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
