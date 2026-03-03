import {MultipleFileInfoInterface, SingleFileInfoInterface} from './Info';

export default interface TorrentInterface {
  info: SingleFileInfoInterface | MultipleFileInfoInterface;
  announce: string;
  'announce-list'?: string[][];
  'creation date'?: number;
  comment?: string;
  'created by'?: string;
  encoding?: string;
}
