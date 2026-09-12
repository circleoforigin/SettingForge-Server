import Fastify from 'fastify'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = Fastify({
  logger: true,
})

const host =
  process.env.SETTINGFORGE_SERVER_HOST ??
  '127.0.0.1'

const portValue =
  process.env.SETTINGFORGE_SERVER_PORT ??
  '3020'

const port = Number(portValue)

if (!Number.isInteger(port) || port <= 0) {
  throw new Error(
    `Invalid SETTINGFORGE_SERVER_PORT: ${portValue}`,
  )
}

const currentFile =
  fileURLToPath(import.meta.url)

const currentDirectory =
  path.dirname(currentFile)

const projectRoot =
  path.resolve(currentDirectory, '..')

const updatesDirectory =
  path.join(
    projectRoot,
    'data',
    'updates',
  )

function getContentType(
  fileName: string,
): string {
  const extension =
    path.extname(fileName).toLowerCase()

  switch (extension) {
    case '.yml':
      return 'text/yaml; charset=utf-8'

    case '.exe':
      return 'application/vnd.microsoft.portable-executable'

    case '.blockmap':
      return 'application/octet-stream'

    default:
      return 'application/octet-stream'
  }
}

app.get('/health', async () => {
  return {
    status: 'ok',
    service: 'SettingForge Server',
    timestamp: new Date().toISOString(),
  }
})

app.get<{
  Params: {
    fileName: string
  }
}>(
  '/updates/:fileName',
  async (request, reply) => {
    const fileName =
      request.params.fileName

    if (
      !fileName ||
      path.basename(fileName) !== fileName
    ) {
      return reply
        .code(404)
        .send({
          error: 'Not found.',
        })
    }

    const extension =
      path.extname(fileName).toLowerCase()

    const allowedExtensions =
      new Set([
        '.yml',
        '.exe',
        '.blockmap',
      ])

    if (
      !allowedExtensions.has(extension)
    ) {
      return reply
        .code(404)
        .send({
          error: 'Not found.',
        })
    }

    const filePath =
      path.join(
        updatesDirectory,
        fileName,
      )

    if (!existsSync(filePath)) {
      return reply
        .code(404)
        .send({
          error: 'Not found.',
        })
    }

    const fileInfo =
      await stat(filePath)

    if (!fileInfo.isFile()) {
      return reply
        .code(404)
        .send({
          error: 'Not found.',
        })
    }

    reply.header(
      'Content-Type',
      getContentType(fileName),
    )

    reply.header(
      'Content-Length',
      fileInfo.size,
    )

    reply.header(
      'Cache-Control',
      'no-store',
    )

    return reply.send(
      createReadStream(filePath),
    )
  },
)

async function start() {
  try {
    await app.listen({
      host,
      port,
    })

    console.log(
      `SettingForge Server listening at http://${host}:${port}`,
    )

    console.log(
      `Update feed: http://${host}:${port}/updates/`,
    )
  } catch (error) {
    app.log.error(error)
    process.exit(1)
  }
}


void start()