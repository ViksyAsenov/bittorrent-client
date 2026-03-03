import TorrentParser from './torrentParser';
import MessagePayloadInterface from './types/MessagePayload';
import TorrentInterface from './types/Torrent';

class Queue {
  public chocked: boolean;
  private queue: MessagePayloadInterface[];
  private torrent: TorrentInterface;

  constructor(torrent: TorrentInterface) {
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

  enqueue(block: MessagePayloadInterface) {
    this.queue.push(block);
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
