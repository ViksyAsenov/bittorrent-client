import {Buffer} from 'buffer';
import crypto from 'crypto';
import generateId from './utils/generateId';
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
  protected torrentParser: TorrentParser;
  protected torrent: Torrent;
  protected decoder: BencodeDecoder;

  constructor(torrent: Torrent) {
    this.torrentParser = new TorrentParser();
    this.torrent = torrent;
    this.decoder = new BencodeDecoder();
  }

  abstract getPeers(callback: (peers: Peer[]) => void): void;
}

export class UdpTracker extends Tracker {
  getPeers(callback: (peers: Peer[]) => void) {
    const url = this.torrent.announce;

    this.udpGetPeers(url, callback);
  }

  private udpGetPeers(url: string, callback: (peers: Peer[]) => void) {
    const socket = dgram.createSocket('udp4');
    console.log(`Connecting to UDP tracker at ${url}`);

    // 1. Send connection request
    const connectionRequest = this.buildConnectionRequest();
    this.udpSend(socket, connectionRequest, url);

    socket.on('message', response => {
      const responseType = this.getResponseType(response);
      console.log(`Received response type: ${responseType}`);
      switch (responseType) {
        case 'connect': {
          // 2. Receive and parse connection response
          const connectionResponse = this.parseConnectionResponse(response);
          console.log('Received connection response:', connectionResponse);

          // 3. Send announce request
          const announceRequest = this.buildAnnounceRequest(
            connectionResponse.connectionId
          );
          this.udpSend(socket, announceRequest, url);
          break;
        }
        case 'announce': {
          // 4. Parse announce response
          const announceResponse: UdpTrackerResponse =
            this.parseAnnounceResponse(response);
          console.log('Received announce response:', announceResponse);

          // 5. Pass peers to callback
          callback(announceResponse.peers);
          break;
        }
        default: {
          console.error(`Unknown response type: ${responseType}`);
          break;
        }
      }
    });

    socket.on('error', (error: Error) => {
      console.error(`Socket error: ${error.message}`);
    });
  }

  private buildConnectionRequest(): Buffer {
    const buffer = Buffer.alloc(16);

    // Connection id which is always 0x41727101980
    buffer.writeUint32BE(0x417, 0);
    buffer.writeUint32BE(0x27101980, 4);

    // Action which is always 0
    buffer.writeUInt32BE(0, 8); // 4

    // Transaction id which is random 4 bytes
    crypto.randomBytes(4).copy(buffer, 12);

    return buffer;
  }

  private getResponseType(response: Buffer): string {
    const action = response.readUInt32BE(0);

    switch (action) {
      case 0:
        return 'connect';
      case 1:
        return 'announce';
    }

    return 'unknown';
  }

  private parseConnectionResponse(response: Buffer) {
    return {
      action: response.readUInt32BE(0),
      transactionId: response.readUInt32BE(4),
      connectionId: response.slice(8),
    };
  }

  private buildAnnounceRequest(connectionId: Buffer, port = 6887): Buffer {
    const buffer = Buffer.alloc(98);

    // Connection id
    connectionId.copy(buffer, 0);

    // Action
    buffer.writeUInt32BE(1, 8);

    // Transaction id
    crypto.randomBytes(4).copy(buffer, 12);

    // Info hash
    Buffer.from(this.torrentParser.getInfoHash(this.torrent), 'hex').copy(
      buffer,
      16
    );

    // Peer id
    generateId().copy(buffer, 36);

    // Downloaded
    Buffer.alloc(8).copy(buffer, 56);

    // Left
    this.torrentParser.getSize(this.torrent).copy(buffer, 64);

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

  private parseAnnounceResponse(response: Buffer): UdpTrackerResponse {
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

    console.log(url);

    socket.send(
      message,
      0,
      message.length,
      Number(url.port),
      url.hostname as string
    );
  }
}

export class HttpTracker extends Tracker {
  async getPeers(callback: (peers: Peer[]) => void) {
    const url = this.torrent.announce;

    await this.httpGetPeers(url, callback);
  }

  private async httpGetPeers(url: string, callback: (peers: Peer[]) => void) {
    try {
      const params: TrackerRequest = {
        peer_id: arr2text(generateId()),
        port: String(6887),
        uploaded: String(0),
        downloaded: String(0),
        left: String(this.torrentParser.getSize(this.torrent).readUInt32BE(0)),
        event: 'started',
        compact: '1',
      };

      // console.log(
      //   `Connecting to HTTP tracker at ${url}&info_hash=${this.encodeBinaryData(
      //     this.torrentParser.getInfoHash(this.torrent)
      //   )}&${new URLSearchParams(params)}`
      // );

      const response = await fetch(
        `${url}&info_hash=${this.encodeBinaryData(
          this.torrentParser.getInfoHash(this.torrent)
        )}&${new URLSearchParams(params)}`
      );

      const data = new Uint8Array(await response.arrayBuffer());

      const peers = this.parseHttpAnnounceResponse(data);
      callback(peers);
    } catch (error) {
      console.error(error);
      console.error(`HTTP tracker error: ${(error as Error).message}`);
    }
  }

  private encodeBinaryData(data: string): string {
    const infoHash = Array.from(data)
      .map((c, i) => (i % 2 === 0 ? `%${c}` : c))
      .join('');

    return infoHash;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatQueryParams(obj: {[key: string]: any}): string {
    return Object.keys(obj)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(obj[key])}`)
      .join('&');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseHttpAnnounceResponse(response: any): Peer[] {
    const peers: Peer[] = [];

    const decodedResponse: HttpTrackerResponse = this.decoder.decode(
      response
    ) as HttpTrackerResponse;

    // console.log(Buffer.from(decodedResponse.peers).toString('hex'));
    for (let i = 0; i < decodedResponse.peers.length; i += 6) {
      const ip = Array.from(response.peers.slice(i, i + 4)).join('.');
      const port = response.peers.readUInt16BE(i + 4);
      peers.push({ip, port});
    }
    return peers;
  }
}

class TrackerBuilder {
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
