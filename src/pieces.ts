import TorrentParser from './torrentParser';
import MessagePayloadInterface from './types/MessagePayload';
import TorrentInterface from './types/Torrent';
import isMultiFileInfo from './utils/isMultiFileInfo';

class Pieces {
  public requested: boolean[][];
  private received: boolean[][];
  private torrent: TorrentInterface;
  private pieceAvailability: number[];
  private receivedBlockCount: number;
  private totalBlockCount: number;
  private requestedNotReceivedCount: number;

  constructor(torrent: TorrentInterface, selectedFileIndices?: Set<number>) {
    this.torrent = torrent;
    this.requested = this.buildPieces();
    this.received = this.buildPieces();

    if (selectedFileIndices && isMultiFileInfo(torrent.info)) {
      this.preMarkSkippedPieces(selectedFileIndices);
    }

    this.pieceAvailability = new Array(this.received.length).fill(0);
    this.receivedBlockCount = this.received.reduce(
      (sum, blocks) => sum + blocks.filter(b => b).length,
      0
    );
    this.totalBlockCount = this.received.reduce(
      (sum, blocks) => sum + blocks.length,
      0
    );
    this.requestedNotReceivedCount = 0;
  }

  private preMarkSkippedPieces(selectedFileIndices: Set<number>) {
    if (!isMultiFileInfo(this.torrent.info)) return;

    const pieceLength = this.torrent.info['piece length'];
    const totalSize = TorrentParser.getSizeToNumber(this.torrent);

    const fileRanges: {start: number; end: number}[] = [];
    let offset = 0;
    for (const file of this.torrent.info.files) {
      fileRanges.push({start: offset, end: offset + file.length});
      offset += file.length;
    }

    for (let p = 0; p < this.received.length; p++) {
      const pieceStart = p * pieceLength;
      const pieceEnd = Math.min((p + 1) * pieceLength, totalSize);

      const touchesSelected = [...selectedFileIndices].some(i => {
        const r = fileRanges[i];
        return pieceStart < r.end && pieceEnd > r.start;
      });

      if (!touchesSelected) {
        this.received[p].fill(true);
        this.requested[p].fill(true);
      }
    }
  }

  addPeerBitfield(bitfield: Buffer) {
    const totalPieces = this.getTotalPieces();

    bitfield.forEach((byte, i) => {
      for (let j = 0; j < 8; j++) {
        if (byte % 2) {
          const pieceIndex = i * 8 + 7 - j;
          if (pieceIndex < totalPieces) {
            this.pieceAvailability[pieceIndex]++;
          }
        }
        byte = Math.floor(byte / 2);
      }
    });
  }

  addPeerHave(pieceIndex: number) {
    if (pieceIndex >= 0 && pieceIndex < this.pieceAvailability.length) {
      this.pieceAvailability[pieceIndex]++;
    }
  }

  removePeerBitfield(peerBitfield: boolean[]) {
    for (
      let i = 0;
      i < peerBitfield.length && i < this.pieceAvailability.length;
      i++
    ) {
      if (peerBitfield[i]) {
        this.pieceAvailability[i] = Math.max(0, this.pieceAvailability[i] - 1);
      }
    }
  }

  getRarestPieces(peerBitfield: boolean[]): number[] {
    // Collect piece indices the peer has that we haven't fully received
    const candidates: {index: number; availability: number}[] = [];
    for (let i = 0; i < peerBitfield.length; i++) {
      if (peerBitfield[i] && !this.received[i]?.every(b => b)) {
        candidates.push({index: i, availability: this.pieceAvailability[i]});
      }
    }

    candidates.sort((a, b) => a.availability - b.availability);

    // Randomize among pieces sharing the lowest availability count
    // to prevent all clients from requesting the same rarest piece
    if (candidates.length > 1) {
      const rarestAvailability = candidates[0].availability;
      let rarestEnd = 0;
      while (
        rarestEnd < candidates.length &&
        candidates[rarestEnd].availability === rarestAvailability
      ) {
        rarestEnd++;
      }

      // Fisher-Yates shuffle on the rarest bucket
      for (let i = rarestEnd - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
      }
    }

    return candidates.map(c => c.index);
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

    if (!this.requested[pieceBlock.index][blockIndex]) {
      this.requested[pieceBlock.index][blockIndex] = true;

      if (!this.received[pieceBlock.index][blockIndex]) {
        this.requestedNotReceivedCount++;
      }
    }
  }

  addReceived(pieceBlock: MessagePayloadInterface) {
    const blockIndex = Math.floor(pieceBlock.begin / TorrentParser.blockLength);

    if (!this.received[pieceBlock.index][blockIndex]) {
      this.received[pieceBlock.index][blockIndex] = true;

      this.receivedBlockCount++;
      if (this.requested[pieceBlock.index][blockIndex]) {
        this.requestedNotReceivedCount--;
      }
    }
  }

  isReceived(pieceBlock: MessagePayloadInterface): boolean {
    const blockIndex = Math.floor(pieceBlock.begin / TorrentParser.blockLength);

    return this.received[pieceBlock.index][blockIndex];
  }

  needed(pieceBlock: MessagePayloadInterface) {
    const blockIndex = Math.floor(pieceBlock.begin / TorrentParser.blockLength);

    // When all blocks have been requested, reset the received state
    // so unreceived blocks can be re-requested
    if (this.requestedNotReceivedCount === 0 && !this.isDone()) {
      this.resetRequested();
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

  isPieceComplete(pieceIndex: number): boolean {
    return this.received[pieceIndex]?.every(b => b) ?? false;
  }

  // Reset requested to match received — called when a peer disconnects
  // so its outstanding requests can be re-requested from other peers
  resetRequested() {
    this.requested = this.received.map(blocks => blocks.slice());
    this.requestedNotReceivedCount = 0;
  }

  isDone() {
    return this.receivedBlockCount === this.totalBlockCount;
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

  getInFlightCount(): number {
    return this.requestedNotReceivedCount;
  }

  isEndGame(): boolean {
    const incompleteBlocks = this.totalBlockCount - this.receivedBlockCount;

    if (incompleteBlocks === 0) return false;

    // Enter endgame when all remaining blocks have been requested at least once
    if (this.requestedNotReceivedCount >= incompleteBlocks) return true;

    // Or when remaining blocks are few enough
    return (
      incompleteBlocks <= this.requestedNotReceivedCount &&
      incompleteBlocks <= 20
    );
  }

  getMissingBlocks(): MessagePayloadInterface[] {
    const blocks: MessagePayloadInterface[] = [];

    this.received.forEach((piece, pieceIndex) => {
      piece.forEach((isReceived, blockIndex) => {
        if (!isReceived) {
          blocks.push({
            index: pieceIndex,
            begin: blockIndex * TorrentParser.blockLength,
            length: TorrentParser.getBlockLength(
              this.torrent,
              pieceIndex,
              blockIndex
            ),
          });
        }
      });
    });

    // Fisher-Yates shuffle to randomize request order across peers
    for (let i = blocks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));

      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    }

    return blocks;
  }

  getTotalPieces(): number {
    return this.received.length;
  }
}

export default Pieces;
