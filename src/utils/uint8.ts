export function arr2text(arr: Uint8Array): string {
  return new TextDecoder().decode(arr);
}

export function text2arr(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function arr2hex(arr: Uint8Array): string {
  return Array.from(arr)
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function concat(chunks: Uint8Array[], size = 0): Uint8Array {
  const length = chunks.length || 0;
  if (!size) {
    let i = length;
    while (i--) size += chunks[i].length;
  }
  const b = new Uint8Array(size);
  let offset = size;
  let i = length;
  while (i--) {
    offset -= chunks[i].length;
    b.set(chunks[i], offset);
  }

  return b;
}

export function getType(value: object) {
  if (ArrayBuffer.isView(value)) return 'arraybufferview';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Number) return 'number';
  if (value instanceof Boolean) return 'boolean';
  if (value instanceof Set) return 'set';
  if (value instanceof Map) return 'map';
  if (value instanceof String) return 'string';
  if (value instanceof ArrayBuffer) return 'arraybuffer';
  return typeof value;
}
