import {Buffer} from 'buffer';
import crypto from 'crypto';
import generatePeerId from './utils/generatePeerId';
import Torrent from './types/Torrent';
import TorrentParser from './torrentParser';
import {
  UdpTrackerResponse,
  HttpTrackerResponse,
  Peer,
} from './types/TrackerResponse';
import TrackerRequest from './types/TrackerRequest';
import dgram, {Socket} from 'dgram';
import {arr2text} from './utils/uint8';
import BencodeDecoder from './decoder';

abstract class Tracker {
  protected torrent: Torrent;

  constructor(torrent: Torrent) {
    this.torrent = torrent;
  }

  // Follows the BitTorrent specification for sending requests to the tracker
  // https://wiki.theory.org/BitTorrentSpecification#Tracker_HTTP.2FHTTPS_Protocol
  abstract getPeers(callback: (peers: Peer[]) => void): void;
}

class UdpTracker extends Tracker {
  getPeers(callback: (peers: Peer[]) => void) {
    const url = this.torrent.announce;

    this.udpGetPeers(url, callback);
  }

  private udpGetPeers(url: string, callback: (peers: Peer[]) => void) {
    const socket = dgram.createSocket('udp4');

    // 1. Send connection request
    const connectionRequest = this.buildUdpConnectionRequest();
    this.udpSend(socket, connectionRequest, url);

    socket.on('message', response => {
      const responseType = this.getUdpResponseType(response);
      switch (responseType) {
        case 'connect': {
          // 2. Receive and parse connection response
          const connectionResponse = this.parseUdpConnectionResponse(response);

          // 3. Send announce request
          const announceRequest = this.buildUdpAnnounceRequest(
            connectionResponse.connectionId
          );
          this.udpSend(socket, announceRequest, url);
          break;
        }
        case 'announce': {
          // 4. Parse announce response
          const announceResponse: UdpTrackerResponse =
            this.parseUdpAnnounceResponse(response);

          // 5. Pass peers to callback
          callback(announceResponse.peers);
          socket.close();
          break;
        }
        default: {
          console.error(`Unknown response type: ${responseType}`);
          break;
        }
      }
    });

    socket.on('error', (error: Error) => {
      console.error(`UDP tracker error: ${error.message}`);
    });
  }

  private buildUdpConnectionRequest(): Buffer {
    const buffer = Buffer.alloc(16);

    // Connection id which is always 0x41727101980
    buffer.writeUint32BE(0x417, 0);
    buffer.writeUint32BE(0x27101980, 4);

    // Action which is always 0
    buffer.writeUInt32BE(0, 8);

    // Transaction id which is random 4 bytes
    crypto.randomBytes(4).copy(buffer, 12);

    return buffer;
  }

  private parseUdpConnectionResponse(response: Buffer) {
    return {
      action: response.readUInt32BE(0),
      transactionId: response.readUInt32BE(4),
      connectionId: response.slice(8),
    };
  }

  private buildUdpAnnounceRequest(connectionId: Buffer, port = 6887): Buffer {
    const buffer = Buffer.alloc(98);

    // Connection id
    connectionId.copy(buffer, 0);

    // Action
    buffer.writeUInt32BE(1, 8);

    // Transaction id
    crypto.randomBytes(4).copy(buffer, 12);

    // Info hash
    Buffer.from(TorrentParser.getInfoHash(this.torrent), 'hex').copy(
      buffer,
      16
    );

    // Peer id
    generatePeerId().copy(buffer, 36);

    // Downloaded
    Buffer.alloc(8).copy(buffer, 56);

    // Left
    TorrentParser.getSizeToBuffer(this.torrent).copy(buffer, 64);

    // Uploaded
    Buffer.alloc(8).copy(buffer, 72);

    // Event
    buffer.writeUInt32BE(0, 80);

    // IP address
    buffer.writeUInt32BE(0, 80);

    // Key
    crypto.randomBytes(4).copy(buffer, 88);

    // Number wanted
    buffer.writeInt32BE(-1, 92);

    // Port should be between 6881 and 6889
    buffer.writeUInt16BE(port, 96);

    return buffer;
  }

  private parseUdpAnnounceResponse(response: Buffer): UdpTrackerResponse {
    function group(iterable: Buffer, groupSize: number) {
      const groups = [];

      for (let i = 0; i < iterable.length; i += groupSize) {
        groups.push(iterable.slice(i, i + groupSize));
      }

      return groups;
    }

    return {
      action: response.readUInt32BE(0),
      transactionId: response.readUInt32BE(4),
      leechers: response.readUInt32BE(8),
      seeders: response.readUInt32BE(12),
      peers: group(response.slice(20), 6).map(addressAndPort => {
        return {
          ip: Array.from(addressAndPort.slice(0, 4)).join('.'),
          port: addressAndPort.readUInt16BE(4),
        };
      }),
    };
  }

  private udpSend(socket: Socket, message: Buffer, rawUrl: string) {
    const url = new URL(rawUrl);

    socket.send(
      message,
      0,
      message.length,
      Number(url.port),
      url.hostname as string
    );
  }

  private getUdpResponseType(response: Buffer): string {
    const action = response.readUInt32BE(0);

    switch (action) {
      case 0:
        return 'connect';
      case 1:
        return 'announce';
    }

    return 'unknown';
  }
}

class HttpTracker extends Tracker {
  async getPeers(callback: (peers: Peer[]) => void) {
    const url = this.torrent.announce;

    await this.httpGetPeers(url, callback);
  }

  private async httpGetPeers(url: string, callback: (peers: Peer[]) => void) {
    try {
      const params: TrackerRequest = {
        peer_id: arr2text(generatePeerId()),
        port: String(6887),
        uploaded: String(0),
        downloaded: String(0),
        left: String(TorrentParser.getSizeToNumber(this.torrent)),
        event: 'started',
        compact: '1',
      };

      const response = await fetch(
        `${url}&info_hash=${this.encodeInfoHash(
          TorrentParser.getInfoHash(this.torrent)
        )}&${new URLSearchParams(params)}`
      );

      const data = new Uint8Array(await response.arrayBuffer());

      const peers = this.parseHttpAnnounceResponse(data);

      callback(peers);
    } catch (error) {
      console.error(`HTTP tracker error: ${(error as Error).message}`);
    }
  }

  private parseHttpAnnounceResponse(response: Uint8Array): Peer[] {
    let rawPeers: Uint8Array = new Uint8Array();

    // Sometimes the format in which the peers are returned is different so we need to check
    try {
      const decodedResponse: HttpTrackerResponse = BencodeDecoder.decode(
        response
      ) as HttpTrackerResponse;

      rawPeers = decodedResponse.peers;
    } catch {
      rawPeers = response;
    }

    const peers: Peer[] = [];
    for (let i = 0; i < rawPeers.length; i += 6) {
      const ipBytes = rawPeers.slice(i, i + 4);
      const portBytes = rawPeers.slice(i + 4, i + 6);

      const ip = ipBytes.join('.');

      // Combine the two port bytes into a single 16-bit integer
      const port = (portBytes[0] << 8) | portBytes[1];

      peers.push({ip, port});
    }

    return peers;
  }

  // Info hash must be encoded using the "%nn" format, where nn is the hexadecimal value of the byte.
  private encodeInfoHash(infoHash: string): string {
    const encodedInfoHash = Array.from(infoHash)
      .map((c, i) => (i % 2 === 0 ? `%${c}` : c))
      .join('');

    return encodedInfoHash;
  }
}

class TrackerBuilder {
  private constructor() {}

  static buildTracker(torrent: Torrent): Tracker {
    const url = torrent.announce;
    const parsedUrl = new URL(url);

    switch (parsedUrl.protocol) {
      case 'udp:': {
        return new UdpTracker(torrent);
      }

      case 'http:':
      case 'https:': {
        return new HttpTracker(torrent);
      }
    }

    throw new Error(`Unsupported tracker protocol: ${parsedUrl.protocol}`);
  }
}

export default TrackerBuilder;
