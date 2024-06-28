import * as fs from 'fs';
import BencodeDecoder from './decoder';
import Torrent from './types/Torrent';
import BencodeEncoder from './encoder';
import crypto from 'crypto';
import {MultipleFileInfo, SingleFileInfo} from './types/Info';
import bignum from 'bignum';

class TorrentParser {
  private decoder: BencodeDecoder;
  private encoder: BencodeEncoder;

  constructor() {
    this.decoder = new BencodeDecoder();
    this.encoder = new BencodeEncoder();
  }

  open(filepath: string): Torrent {
    return this.decoder.decode(fs.readFileSync(filepath)) as Torrent;
  }

  getSizeToBuffer(torrent: Torrent): Buffer {
    const size = (torrent.info as MultipleFileInfo).files
      ? (torrent.info as MultipleFileInfo).files
          .map(file => file.length)
          .reduce((a, b) => a + b)
      : (torrent.info as SingleFileInfo).length;

    return bignum.toBuffer(size, {size: 8, endian: 'big'});
  }

  getSizeToNumber(torrent: Torrent): number {
    const size = (torrent.info as MultipleFileInfo).files
      ? (torrent.info as MultipleFileInfo).files
          .map(file => file.length)
          .reduce((a, b) => a + b)
      : (torrent.info as SingleFileInfo).length;

    return bignum.toNumber(size);
  }

  getInfoHash(torrent: Torrent): string {
    const info = this.encoder.encode(torrent.info);

    return crypto.createHash('sha1').update(info).digest('hex');
  }
}

export default TorrentParser;
