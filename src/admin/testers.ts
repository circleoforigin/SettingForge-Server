import {
  getTesterDatabasePath,
  TesterRepository,
} from '../data/TesterRepository.js'

function usage(): never {
  console.error('Usage:')
  console.error('  npm run testers:add -- <email> [maxDevices]')
  console.error('  npm run testers:list')
  process.exit(1)
}

const [command, email, maxDevicesValue] = process.argv.slice(2)
const repository = new TesterRepository(getTesterDatabasePath())

try {
  if (command === 'add') {
    if (!email) usage()
    const maxDevices = maxDevicesValue === undefined
      ? undefined
      : Number(maxDevicesValue)
    const tester = repository.createTester({ email, maxDevices })
    console.log(`Created tester ${tester.email} (${tester.id}).`)
  } else if (command === 'list') {
    const testers = repository.listTesters()
    if (testers.length === 0) console.log('No approved testers found.')
    for (const tester of testers) {
      console.log(
        `${tester.email} [${tester.status}] ` +
        `${tester.devices.length}/${tester.maxDevices} devices`,
      )
      for (const device of tester.devices) {
        const revoked = device.revokedAt ? ` revoked ${device.revokedAt}` : ''
        console.log(
          `  ${device.deviceName} (${device.deviceId}) ` +
          `last seen ${device.lastSeenAt}${revoked}`,
        )
      }
    }
  } else {
    usage()
  }
} finally {
  repository.close()
}
