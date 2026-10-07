const GZIP_MAGIC = [0x1f, 0x8b];

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === GZIP_MAGIC[0] && bytes[1] === GZIP_MAGIC[1];
}

/** Decodes a fetched playlist/EPG body, transparently gunzipping `.gz` payloads. */
export async function decodeBody(bytes: Uint8Array): Promise<string> {
  let data: Uint8Array = bytes;
  if (isGzip(bytes)) {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
    data = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return new TextDecoder("utf-8").decode(data);
}
