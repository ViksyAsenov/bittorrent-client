import {MultipleFileInfoInterface} from '../types/Info';

export default function isMultiFileInfo(
  obj: unknown
): obj is MultipleFileInfoInterface {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'files' in obj &&
    Array.isArray(obj.files)
  );
}
