import { createHash } from 'node:crypto';

export function sha256Bytes(data: Uint8Array | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function sha256Text(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
