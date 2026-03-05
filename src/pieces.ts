import TorrentParser from './torrentParser';
import MessagePayloadInterface from './types/MessagePayload';
import TorrentInterface from './types/Torrent';

class Pieces {
  public requested: boolean[][];
  private received: boolean[][];
  private torrent: TorrentInterface;

  constructor(torrent: TorrentInterface) {
    this.torrent = torrent;
    this.requested = this.buildPieces();
    this.received = this.buildPieces();
  }

  private buildPieces(): boolean[][] {
    const numberOfPieces = this.torrent.info.pieces.length / 20;

    return Array.from({length: numberOfPieces}, (_, i) => {
      const pieceSize = TorrentParser.getPieceLength(this.torrent, i);
      const blocksPerPiece = Math.ceil(pieceSize / TorrentParser.blockLength);
      return Array(blocksPerPiece).fill(false);
    });
  }

  addRequested(pieceBlock: MessagePayloadInterface) {
    const blockIndex = pieceBlock.begin / TorrentParser.blockLength;

    this.requested[pieceBlock.index][blockIndex] = true;
  }

  addReceived(pieceBlock: MessagePayloadInterface) {
    const blockIndex = Math.floor(pieceBlock.begin / TorrentParser.blockLength);

    this.received[pieceBlock.index][blockIndex] = true;
  }

  isReceived(pieceBlock: MessagePayloadInterface): boolean {
    const blockIndex = Math.floor(pieceBlock.begin / TorrentParser.blockLength);

    return this.received[pieceBlock.index][blockIndex];
  }

  needed(pieceBlock: MessagePayloadInterface) {
    const blockIndex = Math.floor(pieceBlock.begin / TorrentParser.blockLength);

    if (this.requested.every(blocks => blocks.every(i => i))) {
      this.requested = this.received.map(blocks => blocks.slice());
    }

    if (!this.received[pieceBlock.index]) {
      return false;
    }

    // In endgame mode, a block is "needed" if it hasn't been received yet,
    // even if it was already requested from another peer.
    if (this.isEndGame()) {
      return !this.received[pieceBlock.index][blockIndex];
    }

    return !this.requested[pieceBlock.index][blockIndex];
  }

  // Reset requested to match received — called when a peer disconnects
  // so its outstanding requests can be re-requested from other peers
  resetRequested() {
    this.requested = this.received.map(blocks => blocks.slice());
  }

  isDone() {
    return this.received.every(blocks => blocks.every(i => i));
  }

  getPercentDone(): number {
    const downloaded = this.received.reduce((totalBlocks, blocks) => {
      return blocks.filter(i => i).length + totalBlocks;
    }, 0);

    const total = this.received.reduce((totalBlocks, blocks) => {
      return blocks.length + totalBlocks;
    }, 0);

    return Number(((downloaded / total) * 100).toFixed(2));
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

  isEndGame(): boolean {
    const incompleteBlocks = this.received.reduce(
      (sum, blocks) => sum + blocks.filter(b => !b).length,
      0
    );
    return incompleteBlocks > 0 && incompleteBlocks <= 25;
  }

  getMissingBlocks(): MessagePayloadInterface[] {
    const blocks: MessagePayloadInterface[] = [];
    const totalPieces = this.getTotalPieces();

    this.received.forEach((piece, pieceIndex) => {
      piece.forEach((isReceived, blockIndex) => {
        if (!isReceived) {
          const isLastPiece = pieceIndex === totalPieces - 1;
          const isLastBlockInPiece = blockIndex === piece.length - 1;

          let length = TorrentParser.blockLength;
          if (isLastPiece && isLastBlockInPiece) {
            length = TorrentParser.getBlockLength(
              this.torrent,
              pieceIndex,
              blockIndex
            );
          }

          blocks.push({
            index: pieceIndex,
            begin: blockIndex * TorrentParser.blockLength,
            length,
          });
        }
      });
    });
    return blocks;
  }

  getTotalPieces(): number {
    return this.received.length;
  }
}

export default Pieces;
