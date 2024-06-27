import {MultipleFileInfo, SingleFileInfo} from './Info';

interface Torrent {
  info: SingleFileInfo | MultipleFileInfo;
  announce: string;
  'announce-list'?: string[][];
  'creation date'?: number;
  comment?: string;
  'created by'?: string;
  encoding?: string;
}

export default Torrent;
