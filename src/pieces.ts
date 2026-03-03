import TorrentParser from './torrentParser';
import MessagePayloadInterface from './types/MessagePayload';
import TorrentInterface from './types/Torrent';

class Pieces {
  public requested: boolean[][];
  private received: boolean[][];
  private lastReportedPercent: number;
  private torrent: TorrentInterface;

  constructor(torrent: TorrentInterface) {
    this.torrent = torrent;
    this.requested = this.buildPieces();
    this.received = this.buildPieces();
    this.lastReportedPercent = -1;

    // Debug prints
    const totalSize = TorrentParser.getSizeToNumber(torrent);
    const pieceLength = torrent.info['piece length'];
    const numberOfPieces = this.requested.length;
    const numberOfPiecesFromHashes = torrent.info.pieces.length / 20; // Correct count

    console.log('Total size:', totalSize);
    console.log('Piece length:', pieceLength);
    console.log('Number of pieces (from hashes):', numberOfPiecesFromHashes);
    console.log('Number of pieces (built):', numberOfPieces);

    const showCount = Math.min(5, numberOfPieces);
    console.log(`First ${showCount} pieces:`);
    for (let i = 0; i < showCount; i++) {
      const pieceSize = TorrentParser.getPieceLength(torrent, i);
      console.log(
        `Piece ${i}: ${this.requested[i].length} blocks, Piece size: ${pieceSize}`
      );
    }

    if (numberOfPieces > showCount * 2) {
      console.log('...');
    }

    console.log(`Last ${showCount} pieces:`);
    for (
      let i = Math.max(showCount, numberOfPieces - showCount);
      i < numberOfPieces;
      i++
    ) {
      const pieceSize = TorrentParser.getPieceLength(torrent, i);
      console.log(
        `Piece ${i}: ${this.requested[i].length} blocks, Piece size: ${pieceSize}`
      );
    }

    const expectedNumberOfPieces = Math.ceil(totalSize / pieceLength);
    console.log(
      'Expected number of pieces (calculated):',
      expectedNumberOfPieces
    );

    const totalBlocks = this.requested.reduce(
      (sum, blocks) => sum + blocks.length,
      0
    );
    console.log('Total blocks:', totalBlocks);
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
      console.log('All blocks requested - resetting to end-game mode');
      this.requested = this.received.map(blocks => blocks.slice());
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

  printPercentDone() {
    const downloaded = this.received.reduce((totalBlocks, blocks) => {
      return blocks.filter(i => i).length + totalBlocks;
    }, 0);

    const total = this.received.reduce((totalBlocks, blocks) => {
      return blocks.length + totalBlocks;
    }, 0);

    const percent = Number(((downloaded / total) * 100).toFixed(2));

    if (percent > this.lastReportedPercent) {
      console.log(`progress: ${percent}% downloaded: ${downloaded}/${total}`);
      this.lastReportedPercent = percent;

      if (percent > 98) {
        const incompletePieces: number[] = [];
        this.received.forEach((blocks, pieceIndex) => {
          if (!blocks.every(block => block)) {
            incompletePieces.push(pieceIndex);
          }
        });
        console.log(`Incomplete pieces: [${incompletePieces.join(', ')}]`);

        incompletePieces.forEach(pieceIndex => {
          const completedBlocks = this.received[pieceIndex].filter(
            block => block
          ).length;
          const totalBlocks = this.received[pieceIndex].length;
          console.log(
            `Piece ${pieceIndex}: ${completedBlocks}/${totalBlocks} blocks`
          );
        });
      }
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

  isEndGame(): boolean {
    const incompleteBlocks = this.received.reduce(
      (sum, blocks) => sum + blocks.filter(b => !b).length,
      0
    );
    return incompleteBlocks > 0 && incompleteBlocks <= 100;
  }

  // pieces.ts
  getMissingBlocks(): MessagePayloadInterface[] {
    const blocks: MessagePayloadInterface[] = [];
    this.received.forEach((piece, pieceIndex) => {
      piece.forEach((isReceived, blockIndex) => {
        if (!isReceived) {
          blocks.push({
            index: pieceIndex,
            begin: blockIndex * TorrentParser.blockLength,
            length: TorrentParser.blockLength,
          });
        }
      });
    });
    return blocks;
  }

  // pieces.ts
  getTotalPieces(): number {
    return this.received.length;
  }
}

export default Pieces;
