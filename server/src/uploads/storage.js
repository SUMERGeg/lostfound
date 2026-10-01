import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

export function createObjectStorage(environment = process.env) {
  const bucket = required(environment.S3_BUCKET, 'S3_BUCKET')
  const publicBaseUrl = required(environment.S3_PUBLIC_BASE_URL, 'S3_PUBLIC_BASE_URL').replace(/\/$/, '')
  const client = new S3Client({
    region: environment.S3_REGION ?? 'ru-central1',
    endpoint: environment.S3_ENDPOINT || undefined,
    forcePathStyle: environment.S3_FORCE_PATH_STYLE === 'true',
    credentials: environment.S3_ACCESS_KEY_ID && environment.S3_SECRET_ACCESS_KEY
      ? { accessKeyId: environment.S3_ACCESS_KEY_ID, secretAccessKey: environment.S3_SECRET_ACCESS_KEY }
      : undefined
  })

  return {
    async put({ key, body, contentType }) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: 'public, max-age=31536000, immutable' }))
      return `${publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    }
  }
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required for object storage`)
  return value
}
