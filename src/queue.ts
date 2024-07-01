import TorrentParser from './torrentParser';
import MessagePayload from './types/MessagePayload';
import Torrent from './types/Torrent';

class Queue {
  public chocked: boolean;
  private queue: MessagePayload[];
  private torrent: Torrent;

  constructor(torrent: Torrent) {
    this.chocked = true;
    this.queue = [];
    this.torrent = torrent;
  }

  add(pieceIndex: number) {
    const numberOfBlocks = TorrentParser.getBlocksPerPiece(
      this.torrent,
      pieceIndex
    );

    for (let i = 0; i < numberOfBlocks; i++) {
      const pieceBlock = {
        index: pieceIndex,
        begin: i * TorrentParser.blockLength,
        length: TorrentParser.getBlockLength(this.torrent, pieceIndex, i),
      };

      this.queue.push(pieceBlock);
    }
  }

  poll() {
    return this.queue.shift();
  }

  peek() {
    return this.queue[0];
  }

  length() {
    return this.queue.length;
  }
}

export default Queue;
