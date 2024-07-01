import * as fs from 'fs';
import BencodeDecoder from './decoder';
import Torrent from './types/Torrent';
import BencodeEncoder from './encoder';
import crypto from 'crypto';
import {MultipleFileInfo, SingleFileInfo} from './types/Info';
import bignum from 'bignum';

class TorrentParser {
  static blockLength = Math.pow(2, 14);

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
    return bignum.fromBuffer(this.getSizeToBuffer(torrent)).toNumber();
  }

  static getInfoHash(torrent: Torrent): string {
    const info = BencodeEncoder.encode(torrent.info);

    return crypto.createHash('sha1').update(info).digest('hex');
  }

  static getPieceLength(torrent: Torrent, pieceIndex: number) {
    const totalLength = this.getSizeToNumber(torrent);

    const pieceLength = torrent.info['piece length'];

    const lastPieceLength = totalLength % pieceLength;
    const lastPieceIndex = Math.floor(totalLength / pieceLength);

    return lastPieceIndex === pieceIndex ? lastPieceLength : pieceLength;
  }

  static getBlocksPerPiece(torrent: Torrent, pieceIndex: number) {
    const pieceLength = this.getPieceLength(torrent, pieceIndex);

    return Math.ceil(pieceLength / this.blockLength);
  }

  static getBlockLength(
    torrent: Torrent,
    pieceIndex: number,
    blockIndex: number
  ) {
    const pieceLength = this.getPieceLength(torrent, pieceIndex);

    const lastPieceLength = pieceLength % this.blockLength;
    const lastPieceIndex = Math.floor(pieceLength / this.blockLength);

    return blockIndex === lastPieceIndex ? lastPieceLength : this.blockLength;
  }
}

export default TorrentParser;
