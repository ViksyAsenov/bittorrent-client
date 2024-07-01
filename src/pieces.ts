import TorrentParser from './torrentParser';
import Torrent from './types/Torrent';

// TODO: Finish rest of the pieces
class Pieces {
  private requested: boolean[][];
  private received: boolean[][];

  constructor(torrent: Torrent) {
    function buildPieces() {
      const numberOfPieces = torrent.info.pieces.length / 20;

      const pieces: boolean[][] = [];

      // for (let i = 0; i < numberOfPieces; i++) {
      //   pieces[i].push(
      //     new Array(TorrentParser.getBlocksPerPiece(torrent, i)).fill(
      //       false
      //     ) as boolean[]
      //   );
      // }

      return pieces;
    }
    this.requested = buildPieces();
    this.received = buildPieces();
  }

  addRequested(pieceIndex: number) {
    //this.requested[pieceIndex] = true;
  }

  addReceived(pieceIndex: number) {
    //this.received[pieceIndex] = true;
  }

  needed(pieceIndex: number) {
    if (this.requested.every(piece => piece)) {
      this.requested = [...this.received];
    }

    return !this.requested[pieceIndex];
  }

  isDone() {
    return this.received.every(piece => piece);
  }
}

export default Pieces;
