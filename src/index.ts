import express from 'express'
import request from 'request'
import crypto from 'crypto'
import FileType from 'file-type'
import fs from 'fs'

const app = express()

app.get('/proxy', (req, res) => {
  const url = req.query['url']
  console.group(`\nReceived request for "${url}"`)

  const fresh = !!req.query[`fresh`] && req.query[`fresh`] != 'false'
  if (fresh) console.log(`Requested a fresh response`)

  const filePath = `${process.env.CACHE_DIR || 'cache'}/${crypto
    .createHash('md5')
    .update(url)
    .digest('hex')}`
  const maxAgeMs =
    Number(process.env.MAX_AGE_MS) || 1000 * 60 * 60 * 24 * 365.25 * 100 // or 100 years

  if (
    fs.existsSync(filePath) &&
    Date.now() - fs.statSync(filePath).atimeMs < maxAgeMs &&
    !fresh
  ) {
    streamFromCache(filePath, req, res).catch(err => res.status(500).json(err))
  } else {
    saveCacheThenStreamFromCache(url, filePath, req, res).catch(err =>
      res.status(500).json(err)
    )
  }

  console.groupEnd()
})

const port = Number(process.env.PORT) || Number(process.env.PROXY_PORT) || 1414
app.listen(port, () => console.log(`Listening on port ${port}`))

// METHODS:

async function saveCacheThenStreamFromCache(
  url: string,
  filePath: string,
  req: express.Request,
  res: express.Response
) {
  const writable = request(url).pipe(fs.createWriteStream(filePath))
  writable.on('close', () => {
    streamFromCache(filePath, req, res).catch(err => res.status(500).json(err))
  })

  console.log(`Saving cache to "${filePath}"`)
}

async function streamFromCache(
  filePath: string,
  req: express.Request,
  res: express.Response
) {
  const stat = fs.statSync(filePath)
  const total = stat.size
  const mimeType = (await FileType.fromFile(filePath))?.mime
  if (req.headers.range) {
    const range = req.headers.range
    const parts = range.replace(/bytes=/, '').split('-')
    const partialStart = parts[0]
    const partialEnd = parts[1]

    const start = parseInt(partialStart, 10)
    const end = partialEnd ? parseInt(partialEnd, 10) : total - 1
    const chunkSize = end - start + 1
    const readStream = fs.createReadStream(filePath, { start: start, end: end })
    res.writeHead(206, {
      'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType
    })
    readStream.pipe(res)
  } else {
    res.writeHead(200, { 'Content-Length': total, 'Content-Type': mimeType })
    fs.createReadStream(filePath).pipe(res)
  }
  console.log(`Streaming response from "${filePath}"`)
}
