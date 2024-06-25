import {MultipleFileInfo, SingleFileInfo} from './Info';

interface Torrent {
  info: SingleFileInfo | MultipleFileInfo;
  announce: Buffer;
  'announce-list'?: string[][];
  'creation date'?: number;
  comment?: string;
  'created by'?: string;
  encoding?: string;
}

export default Torrent;
