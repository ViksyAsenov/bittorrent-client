import crypto from 'crypto';

let id: Buffer | null = null;

export default function generateId(): Buffer {
  if (!id) {
    id = crypto.randomBytes(20);
    // VT stands for Viksy Torrent
    // This is a list of the known bittorrent clients
    // https://www.bittorrent.org/beps/bep_0020.html
    Buffer.from('-VT0001-').copy(id, 0);
  }

  return id;
}
