import TorrentParser from './torrentParser';
import MessagePayload from './types/MessagePayload';
import Torrent from './types/Torrent';

class Pieces {
  public requested: boolean[][];
  private received: boolean[][];
  private lastReportedPercent: number;
  private torrent: Torrent;

  constructor(torrent: Torrent) {
    this.torrent = torrent;
    this.requested = this.buildPieces();
    this.received = this.buildPieces();
    this.lastReportedPercent = -1;

    // Debug prints
    const totalSize = TorrentParser.getSizeToNumber(torrent);
    const pieceLength = torrent.info['piece length'];
    const numberOfPieces = this.requested.length;

    console.log('Total size:', totalSize);
    console.log('Piece length:', pieceLength);
    console.log('Number of pieces:', numberOfPieces);
    this.requested.forEach((blocks, i) => {
      const pieceSize = TorrentParser.getPieceLength(torrent, i);
      console.log(
        `Piece ${i}: ${blocks.length} blocks, Piece size: ${pieceSize}`
      );
    });

    const expectedNumberOfPieces = Math.ceil(totalSize / pieceLength);
    console.log('Expected number of pieces:', expectedNumberOfPieces);

    const totalBlocks = this.requested.reduce(
      (sum, blocks) => sum + blocks.length,
      0
    );
    console.log('Total blocks:', totalBlocks);
  }

  private buildPieces(): boolean[][] {
    const totalSize = TorrentParser.getSizeToNumber(this.torrent);
    const pieceLength = this.torrent.info['piece length'];
    const numberOfPieces = Math.ceil(totalSize / pieceLength);

    return Array.from({length: numberOfPieces}, (_, i) => {
      const pieceSize =
        i === numberOfPieces - 1
          ? totalSize % pieceLength || pieceLength
          : pieceLength;
      const blocksPerPiece = Math.ceil(pieceSize / TorrentParser.blockLength);
      return Array(blocksPerPiece).fill(false);
    });
  }

  addRequested(pieceBlock: MessagePayload) {
    const blockIndex = pieceBlock.begin / TorrentParser.blockLength;
    this.requested[pieceBlock.index][blockIndex] = true;
  }

  addReceived(pieceBlock: MessagePayload) {
    const blockIndex = pieceBlock.begin / TorrentParser.blockLength;
    this.received[pieceBlock.index][blockIndex] = true;
  }

  needed(pieceBlock: MessagePayload) {
    if (this.requested.every(blocks => blocks.every(i => i))) {
      this.requested = this.received.map(blocks => blocks.slice());
    }

    const blockIndex = pieceBlock.begin / TorrentParser.blockLength;
    return !this.requested[pieceBlock.index][blockIndex];
  }

  isDone() {
    return this.received.every(blocks => blocks.every(i => i));
  }

  printPercentDone() {
    const downloaded = this.received.reduce((totalBlocks, blocks) => {
      return blocks.filter(i => i).length + totalBlocks;
    }, 0);

    const total = this.received.reduce((totalBlocks, blocks) => {
      return blocks.length + totalBlocks;
    }, 0);

    const percent = Math.floor((downloaded / total) * 100);

    if (percent > this.lastReportedPercent) {
      console.log(`progress: ${percent}% downloaded: ${downloaded}/${total}`);
      this.lastReportedPercent = percent;
    }
  }

  getBitfield(): Buffer {
    const bitfield = Buffer.alloc(Math.ceil(this.received.length / 8));
    this.received.forEach((blocks, index) => {
      if (blocks.every(i => i)) {
        bitfield[Math.floor(index / 8)] |= 1 << (7 - (index % 8));
      }
    });
    return bitfield;
  }
}

export default Pieces;
