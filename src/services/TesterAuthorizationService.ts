import {
  TesterDataError,
  TesterDevice,
  TesterRepository,
} from '../data/TesterRepository.js'

export type AuthorizationErrorCode =
  | 'invalid-request'
  | 'authorization-denied'

export class AuthorizationError extends Error {
  constructor(
    readonly code: AuthorizationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'AuthorizationError'
  }
}

export interface DeviceAuthorizationInput {
  email: string
  deviceId: string
  deviceName?: string
}

export interface DeviceAuthorizationResult {
  authorized: true
  device: TesterDevice
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validateInput(input: DeviceAuthorizationInput): void {
  const email = input.email?.trim()
  if (!email || !email.includes('@')) {
    throw new AuthorizationError('invalid-request', 'A valid email is required.')
  }
  if (!uuidPattern.test(input.deviceId ?? '')) {
    throw new AuthorizationError('invalid-request', 'A valid device ID is required.')
  }
}

function denyAuthorization(): never {
  throw new AuthorizationError(
    'authorization-denied',
    'This tester or device is not authorized.',
  )
}

export class TesterAuthorizationService {
  private readonly repository: TesterRepository

  constructor(repository: TesterRepository) {
    this.repository = repository
  }

  register(input: DeviceAuthorizationInput): DeviceAuthorizationResult {
    validateInput(input)
    const deviceName = input.deviceName?.trim()
    if (!deviceName || deviceName.length > 100) {
      throw new AuthorizationError(
        'invalid-request',
        'A device name of 100 characters or fewer is required.',
      )
    }

    return this.repository.transaction(() => {
      const tester = this.repository.getTesterByEmail(input.email)
      if (!tester || tester.status !== 'active') denyAuthorization()

      const existing = this.repository.getDeviceByDeviceId(input.deviceId)
      if (existing) {
        if (existing.userId !== tester.id || existing.revokedAt) {
          denyAuthorization()
        }
        const device = this.repository.updateDeviceLastSeen(input.deviceId)
        if (!device) denyAuthorization()
        return { authorized: true, device }
      }

      if (this.repository.countActiveDevices(tester.id) >= tester.maxDevices) {
        denyAuthorization()
      }

      try {
        const device = this.repository.addDevice({
          userId: tester.id,
          deviceId: input.deviceId,
          deviceName,
        })
        return { authorized: true, device }
      } catch (error) {
        if (error instanceof TesterDataError) denyAuthorization()
        throw error
      }
    })
  }

  validate(input: DeviceAuthorizationInput): DeviceAuthorizationResult {
    validateInput(input)
    const tester = this.repository.getTesterByEmail(input.email)
    const device = this.repository.getDeviceByDeviceId(input.deviceId)
    if (!tester || tester.status !== 'active' || !device) denyAuthorization()
    if (device.userId !== tester.id || device.revokedAt) denyAuthorization()

    const updatedDevice = this.repository.updateDeviceLastSeen(input.deviceId)
    if (!updatedDevice) denyAuthorization()
    return { authorized: true, device: updatedDevice }
  }
}
