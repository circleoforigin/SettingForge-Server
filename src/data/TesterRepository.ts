import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

export type TesterStatus = 'active' | 'disabled'

export interface Tester {
  id: string
  email: string
  status: TesterStatus
  maxDevices: number
  createdAt: string
  updatedAt: string
}

export interface TesterDevice {
  id: string
  userId: string
  deviceId: string
  deviceName: string
  activatedAt: string
  lastSeenAt: string
  revokedAt: string | null
}

export interface TesterWithDevices extends Tester {
  devices: TesterDevice[]
}

interface TesterRow {
  id: string
  email: string
  status: TesterStatus
  max_devices: number
  created_at: string
  updated_at: string
}

interface DeviceRow {
  id: string
  user_id: string
  device_id: string
  device_name: string
  activated_at: string
  last_seen_at: string
  revoked_at: string | null
}

export class TesterDataError extends Error {
  constructor(
    readonly code: 'duplicate-email' | 'duplicate-device' | 'unknown-user',
    message: string,
  ) {
    super(message)
    this.name = 'TesterDataError'
  }
}

function testerFromRow(row: TesterRow): Tester {
  return {
    id: row.id,
    email: row.email,
    status: row.status,
    maxDevices: row.max_devices,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function deviceFromRow(row: DeviceRow): TesterDevice {
  return {
    id: row.id,
    userId: row.user_id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    activatedAt: row.activated_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at,
  }
}

export class TesterRepository {
  private readonly database: DatabaseSync

  constructor(filePath: string) {
    if (filePath !== ':memory:') {
      mkdirSync(path.dirname(filePath), { recursive: true })
    }
    this.database = new DatabaseSync(filePath)
    this.database.exec('PRAGMA foreign_keys = ON')
    if (filePath !== ':memory:') {
      this.database.exec('PRAGMA journal_mode = WAL')
    }
    this.initialize()
  }

  createTester(input: {
    email: string
    status?: TesterStatus
    maxDevices?: number
  }): Tester {
    const email = input.email.trim().toLowerCase()
    const maxDevices = input.maxDevices ?? 1
    if (!email) throw new Error('Tester email is required.')
    if (!Number.isInteger(maxDevices) || maxDevices < 1) {
      throw new Error('maxDevices must be a positive integer.')
    }

    const now = new Date().toISOString()
    const tester: Tester = {
      id: crypto.randomUUID(),
      email,
      status: input.status ?? 'active',
      maxDevices,
      createdAt: now,
      updatedAt: now,
    }

    try {
      this.database.prepare(`
        INSERT INTO testers (
          id, email, status, max_devices, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        tester.id,
        tester.email,
        tester.status,
        tester.maxDevices,
        tester.createdAt,
        tester.updatedAt,
      )
    } catch (error) {
      if (String(error).includes('testers.email')) {
        throw new TesterDataError(
          'duplicate-email',
          `A tester already exists for ${email}.`,
        )
      }
      throw error
    }
    return tester
  }

  addDevice(input: {
    userId: string
    deviceId: string
    deviceName: string
  }): TesterDevice {
    if (!this.getTester(input.userId)) {
      throw new TesterDataError('unknown-user', 'Tester does not exist.')
    }
    const now = new Date().toISOString()
    const device: TesterDevice = {
      id: crypto.randomUUID(),
      userId: input.userId,
      deviceId: input.deviceId,
      deviceName: input.deviceName.trim(),
      activatedAt: now,
      lastSeenAt: now,
      revokedAt: null,
    }

    try {
      this.database.prepare(`
        INSERT INTO devices (
          id, user_id, device_id, device_name,
          activated_at, last_seen_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        device.id,
        device.userId,
        device.deviceId,
        device.deviceName,
        device.activatedAt,
        device.lastSeenAt,
        device.revokedAt,
      )
    } catch (error) {
      if (String(error).includes('devices.device_id')) {
        throw new TesterDataError(
          'duplicate-device',
          `Device ${device.deviceId} is already registered.`,
        )
      }
      throw error
    }
    return device
  }

  getTester(id: string): Tester | null {
    const row = this.database.prepare(`
      SELECT id, email, status, max_devices, created_at, updated_at
      FROM testers WHERE id = ?
    `).get(id) as unknown as TesterRow | undefined
    return row ? testerFromRow(row) : null
  }

  listTesters(): TesterWithDevices[] {
    const testers = this.database.prepare(`
      SELECT id, email, status, max_devices, created_at, updated_at
      FROM testers ORDER BY email
    `).all() as unknown as TesterRow[]
    const devices = this.database.prepare(`
      SELECT id, user_id, device_id, device_name,
        activated_at, last_seen_at, revoked_at
      FROM devices ORDER BY activated_at
    `).all() as unknown as DeviceRow[]

    return testers.map((row) => ({
      ...testerFromRow(row),
      devices: devices
        .filter((device) => device.user_id === row.id)
        .map(deviceFromRow),
    }))
  }

  close(): void {
    this.database.close()
  }

  private initialize(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS testers (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        max_devices INTEGER NOT NULL DEFAULT 1 CHECK (max_devices >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL UNIQUE,
        device_name TEXT NOT NULL,
        activated_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES testers(id) ON DELETE RESTRICT
      );

      CREATE INDEX IF NOT EXISTS devices_user_id_index
        ON devices(user_id);
      CREATE INDEX IF NOT EXISTS devices_active_user_index
        ON devices(user_id, revoked_at);
    `)
  }
}

export function getTesterDatabasePath(): string {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
  const projectRoot = path.resolve(currentDirectory, '..', '..')
  const dataDirectory = process.env.SETTINGFORGE_DATA_DIR ||
    path.join(projectRoot, 'data')
  return path.join(dataDirectory, 'settingforge.sqlite')
}
