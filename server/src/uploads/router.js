import { Router } from 'express'
import Busboy from 'busboy'
import { authenticateAccessToken, requireVerifiedEmail } from '../auth/middleware.js'
import { createRateLimit } from '../rateLimit.js'
import { ImageValidationError, MAX_IMAGE_BYTES } from './imageValidation.js'
import { storeImage } from './service.js'

const router = Router()
const uploadLimit = createRateLimit({ windowMs: 60 * 60 * 1000, max: 30, keyPrefix: 'uploads' })

router.post('/', authenticateAccessToken, requireVerifiedEmail, uploadLimit, async (req, res, next) => {
  try {
    const image = await readSingleImage(req)
    const upload = await storeImage({ ownerId: req.auth.userId, ...image })
    res.status(201).json(upload)
  } catch (error) {
    if (error instanceof ImageValidationError || error instanceof MultipartValidationError) {
      return res.status(400).json({ error: 'invalid_upload', message: error.message })
    }
    next(error)
  }
})

export function readSingleImage(req) {
  return new Promise((resolve, reject) => {
    let parser
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: MAX_IMAGE_BYTES, fields: 0, parts: 1 }
      })
    } catch {
      reject(new MultipartValidationError('multipart/form-data request is required'))
      return
    }

    let file = null
    let failed = false
    const fail = error => {
      if (failed) return
      failed = true
      reject(error)
    }

    parser.on('file', (name, stream, info) => {
      if (name !== 'image' || file) {
        stream.resume()
        fail(new MultipartValidationError('Exactly one image field is required'))
        return
      }
      const chunks = []
      let truncated = false
      stream.on('data', chunk => chunks.push(chunk))
      stream.on('limit', () => { truncated = true })
      stream.on('error', fail)
      stream.on('end', () => {
        if (truncated) return fail(new MultipartValidationError('Image exceeds the 8 MB limit'))
        file = { buffer: Buffer.concat(chunks), contentType: info.mimeType }
      })
    })
    parser.on('filesLimit', () => fail(new MultipartValidationError('Only one image can be uploaded at a time')))
    parser.on('error', error => fail(new MultipartValidationError(error.message)))
    parser.on('finish', () => {
      if (!failed) {
        if (!file) fail(new MultipartValidationError('Image is required'))
        else resolve(file)
      }
    })
    req.pipe(parser)
  })
}

export class MultipartValidationError extends Error {}

export default router
