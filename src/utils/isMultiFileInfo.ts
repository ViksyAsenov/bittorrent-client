export default function isMultiFileInfo(
  obj: unknown
): obj is {files: {path: string[]; length: number}[]} {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    Array.isArray((obj as {files?: unknown}).files)
  );
}
