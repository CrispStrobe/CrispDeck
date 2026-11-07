/** An expected client error; its message is safe to return to the caller. */
export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Parse bounded JSON without trusting Content-Length or JSON's runtime shape. */
export async function readJsonObject(request: Request | Response, maxBytes = 16_384): Promise<Record<string, unknown>> {
  const declaredLength = Number(request.headers.get('content-length'));
  if (declaredLength > maxBytes) throw new HttpError(413, 'JSON body is too large');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Expected a JSON object');

  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, 'JSON body is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, 'Expected a JSON object');
  }
}
