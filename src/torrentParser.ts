import * as fs from 'fs';
import BencodeDecoder from './decoder';
import TorrentInterface from './types/Torrent';
import BencodeEncoder from './encoder';
import crypto from 'crypto';
import bignum from 'bignum';
import isMultiFileInfo from './utils/isMultiFileInfo';

class TorrentParser {
  static blockLength = Math.pow(2, 14);

  private constructor() {}

  static open(filepath: string): TorrentInterface {
    return BencodeDecoder.decode(fs.readFileSync(filepath)) as TorrentInterface;
  }

  static getSizeToBuffer(torrent: TorrentInterface): Buffer {
    const size = isMultiFileInfo(torrent.info)
      ? torrent.info.files.map(file => file.length).reduce((a, b) => a + b)
      : torrent.info.length;

    return bignum.toBuffer(size, {size: 8, endian: 'big'});
  }

  static getSizeToNumber(torrent: TorrentInterface): number {
    return bignum.fromBuffer(this.getSizeToBuffer(torrent)).toNumber();
  }

  static getInfoHash(torrent: TorrentInterface): string {
    const info = BencodeEncoder.encode(torrent.info);

    return crypto.createHash('sha1').update(info).digest('hex');
  }

  static getPieceLength(torrent: TorrentInterface, pieceIndex: number) {
    const totalLength = this.getSizeToNumber(torrent);

    const pieceLength = torrent.info['piece length'];

    const lastPieceLength = totalLength % pieceLength;
    const lastPieceIndex = Math.floor(totalLength / pieceLength);

    if (lastPieceLength === 0) {
      return pieceLength;
    }

    return lastPieceIndex === pieceIndex ? lastPieceLength : pieceLength;
  }

  static getBlocksPerPiece(torrent: TorrentInterface, pieceIndex: number) {
    const pieceLength = this.getPieceLength(torrent, pieceIndex);

    return Math.ceil(pieceLength / this.blockLength);
  }

  static getBlockLength(
    torrent: TorrentInterface,
    pieceIndex: number,
    blockIndex: number
  ) {
    const pieceLength = this.getPieceLength(torrent, pieceIndex);

    const lastBlockLength = pieceLength % this.blockLength;
    const lastBlockIndex = Math.ceil(pieceLength / this.blockLength) - 1;

    if (lastBlockLength === 0) {
      return this.blockLength;
    }

    return blockIndex === lastBlockIndex ? lastBlockLength : this.blockLength;
  }
}

export default TorrentParser;
