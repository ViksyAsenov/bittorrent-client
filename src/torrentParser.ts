import * as fs from 'fs';
import BencodeDecoder from './decoder';
import Torrent from './types/Torrent';
import BencodeEncoder from './encoder';
import crypto from 'crypto';
import {MultipleFileInfo, SingleFileInfo} from './types/Info';
import bignum from 'bignum';

class TorrentParser {
  private constructor() {}

  static open(filepath: string): Torrent {
    return BencodeDecoder.decode(fs.readFileSync(filepath)) as Torrent;
  }

  static getSizeToBuffer(torrent: Torrent): Buffer {
    const size = (torrent.info as MultipleFileInfo).files
      ? (torrent.info as MultipleFileInfo).files
          .map(file => file.length)
          .reduce((a, b) => a + b)
      : (torrent.info as SingleFileInfo).length;

    return bignum.toBuffer(size, {size: 8, endian: 'big'});
  }

  static getSizeToNumber(torrent: Torrent): number {
    const size = (torrent.info as MultipleFileInfo).files
      ? (torrent.info as MultipleFileInfo).files
          .map(file => file.length)
          .reduce((a, b) => a + b)
      : (torrent.info as SingleFileInfo).length;

    return bignum.toNumber(size);
  }

  static getInfoHash(torrent: Torrent): string {
    const info = BencodeEncoder.encode(torrent.info);

    return crypto.createHash('sha1').update(info).digest('hex');
  }
}

export default TorrentParser;
