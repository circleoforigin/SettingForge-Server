import Fastify from 'fastify'
import { createReadStream, existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  getTesterDatabasePath,
  TesterRepository,
} from './data/TesterRepository.js'
import { registerActivationRoutes } from './routes/ActivationRoutes.js'
import { TesterAuthorizationService } from './services/TesterAuthorizationService.js'

const app = Fastify({
  logger: true,
})

const testerRepository = new TesterRepository(getTesterDatabasePath())
const authorizationService = new TesterAuthorizationService(testerRepository)
app.addHook('onClose', async () => testerRepository.close())
await registerActivationRoutes(app, { authorizationService })

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

type ByteRange = {
  start: number
  end: number
}

function parseSingleByteRange(
  rangeText: string,
  fileSize: number,
): ByteRange | null {
  const match = /^(\d*)-(\d*)$/.exec(
    rangeText.trim(),
  )

  if (!match) {
    return null
  }

  const startText = match[1]
  const endText = match[2]

  if (!startText && !endText) {
    return null
  }

  let start: number
  let end: number

  if (!startText) {
    const suffixLength = Number(endText)

    if (
      !Number.isSafeInteger(suffixLength) ||
      suffixLength <= 0
    ) {
      return null
    }

    start = Math.max(
      fileSize - suffixLength,
      0,
    )
    end = fileSize - 1
  } else {
    start = Number(startText)

    if (
      !Number.isSafeInteger(start) ||
      start < 0 ||
      start >= fileSize
    ) {
      return null
    }

    if (endText) {
      end = Number(endText)

      if (
        !Number.isSafeInteger(end) ||
        end < start
      ) {
        return null
      }

      end = Math.min(
        end,
        fileSize - 1,
      )
    } else {
      end = fileSize - 1
    }
  }

  return {
    start,
    end,
  }
}

function parseByteRanges(
  rangeHeader: string,
  fileSize: number,
): ByteRange[] | null {
  const match = /^bytes=(.+)$/i.exec(
    rangeHeader.trim(),
  )

  if (!match) {
    return null
  }

  const ranges = match[1]
    .split(',')
    .map((rangeText) =>
      parseSingleByteRange(
        rangeText,
        fileSize,
      ),
    )

  if (
    ranges.length === 0 ||
    ranges.some((range) => range === null)
  ) {
    return null
  }

  return ranges as ByteRange[]
}

function createMultipartRangeStream(
  filePath: string,
  ranges: ByteRange[],
  fileSize: number,
  contentType: string,
  boundary: string,
): Readable {
  async function* generate() {
    for (const range of ranges) {
      yield Buffer.from(
        `--${boundary}\r\n` +
        `Content-Type: ${contentType}\r\n` +
        `Content-Range: bytes ${range.start}-${range.end}/${fileSize}\r\n` +
        `\r\n`,
        'utf8',
      )

      const fileStream = createReadStream(
        filePath,
        {
          start: range.start,
          end: range.end,
        },
      )

      for await (const chunk of fileStream) {
        yield chunk
      }

      yield Buffer.from(
        '\r\n',
        'utf8',
      )
    }

    yield Buffer.from(
      `--${boundary}--\r\n`,
      'utf8',
    )
  }

  return Readable.from(generate())
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

    const contentType =
      getContentType(fileName)

    reply.header(
      'Cache-Control',
      'no-store',
    )

    reply.header(
      'Accept-Ranges',
      'bytes',
    )

    const rangeHeader =
      request.headers.range

    if (rangeHeader) {
      const ranges = parseByteRanges(
        rangeHeader,
        fileInfo.size,
      )

      if (!ranges) {
        reply.header(
          'Content-Range',
          `bytes */${fileInfo.size}`,
        )

        return reply
          .code(416)
          .send()
      }

      if (ranges.length === 1) {
        const range = ranges[0]
        const contentLength =
          range.end - range.start + 1

        reply.header(
          'Content-Type',
          contentType,
        )

        reply.header(
          'Content-Range',
          `bytes ${range.start}-${range.end}/${fileInfo.size}`,
        )

        reply.header(
          'Content-Length',
          contentLength,
        )

        return reply
          .code(206)
          .send(
            createReadStream(
              filePath,
              {
                start: range.start,
                end: range.end,
              },
            ),
          )
      }

      const boundary =
        `settingforge-${Date.now().toString(16)}`

      reply.header(
        'Content-Type',
        `multipart/byteranges; boundary=${boundary}`,
      )

      return reply
        .code(206)
        .send(
          createMultipartRangeStream(
            filePath,
            ranges,
            fileInfo.size,
            contentType,
            boundary,
          ),
        )
    }

    reply.header(
      'Content-Type',
      contentType,
    )

    reply.header(
      'Content-Length',
      fileInfo.size,
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
