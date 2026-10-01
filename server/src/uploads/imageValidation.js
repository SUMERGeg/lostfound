export const MAX_IMAGE_BYTES = 8 * 1024 * 1024

const signatures = [
  { contentType: 'image/jpeg', extension: 'jpg', matches: buffer => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  { contentType: 'image/png', extension: 'png', matches: buffer => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { contentType: 'image/webp', extension: 'webp', matches: buffer => buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP' }
]

export class ImageValidationError extends Error {}

export function validateImage(buffer, declaredContentType) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new ImageValidationError('Image is empty')
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ImageValidationError('Image exceeds the 8 MB limit')
  }

  const detected = signatures.find(signature => signature.matches(buffer))
  if (!detected) {
    throw new ImageValidationError('Only JPEG, PNG and WebP images are allowed')
  }
  if (declaredContentType && declaredContentType.toLowerCase() !== detected.contentType) {
    throw new ImageValidationError('Declared image type does not match file contents')
  }
  return detected
}
