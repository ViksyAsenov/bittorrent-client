import {Buffer} from 'buffer';
import crypto from 'crypto';
import generateId from './utils/generateId';
import Torrent from './types/Torrent';
import TorrentParser from './torrentParser';
import TrackerResponse, {Peer} from './types/TrackerResponse';
import {arr2text} from './utils/uint8';
import TrackerRequest from './types/TrackerRequest';
import dgram, {Socket} from 'dgram';

abstract class Tracker {
  protected torrentParser: TorrentParser;
  protected torrent: Torrent;

  constructor(torrent: Torrent) {
    this.torrentParser = new TorrentParser();
    this.torrent = torrent;
  }

  abstract getPeers(callback: (peers: Peer[]) => void): void;
}

class UdpTracker extends Tracker {
  getPeers(callback: (peers: Peer[]) => void) {
    const url = arr2text(this.torrent.announce);

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
          const announceResponse: TrackerResponse =
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
    this.torrentParser.getInfoHash(this.torrent).copy(buffer, 16);

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

  private parseAnnounceResponse(response: Buffer): TrackerResponse {
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

class HttpTracker extends Tracker {
  async getPeers(callback: (peers: Peer[]) => void) {
    const url = arr2text(this.torrent.announce);

    await this.httpGetPeers(url, callback);
  }

  private async httpGetPeers(url: string, callback: (peers: Peer[]) => void) {
    try {
      const params: TrackerRequest = {
        info_hash: this.encodeBinaryData(
          this.torrentParser.getInfoHash(this.torrent)
        ),
        peer_id: this.encodeBinaryData(generateId()),
        port: 6887,
        uploaded: 0,
        downloaded: 0,
        left: this.torrentParser.getSize(this.torrent).readUInt32BE(0),
        compact: 1,
        event: 'started',
      };

      const queryString = this.serialize(params);
      console.log(`Connecting to HTTP tracker at ${url}?${queryString}`);

      const response = await fetch(`${url}?${queryString}`);
      const data = await response.json();

      const peers = this.parseHttpAnnounceResponse(data);
      callback(peers);
    } catch (error) {
      console.error(`HTTP tracker error: ${(error as Error).message}`);
    }
  }

  private encodeBinaryData(buffer: Uint8Array): string {
    const safeChars = new Set(
      '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-_~'.split(
        ''
      )
    );
    let encodedStr = '';
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      const char = String.fromCharCode(byte);
      if (safeChars.has(char)) {
        encodedStr += char;
      } else {
        encodedStr += '%' + byte.toString(16).toUpperCase();
      }
    }
    return encodedStr;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private serialize(obj: {[key: string]: any}): string {
    return Object.keys(obj)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(obj[key])}`)
      .join('&');
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseHttpAnnounceResponse(response: any): Peer[] {
    // Assume response.peers is a string with peers encoded in the compact format
    const peers: Peer[] = [];
    console.log(response);
    for (let i = 0; i < response.peers.length; i += 6) {
      const ip = Array.from(response.peers.slice(i, i + 4)).join('.');
      const port = response.peers.readUInt16BE(i + 4);
      peers.push({ip, port});
    }
    return peers;
  }
}

class TrackerBuilder {
  static buildTracker(torrent: Torrent): Tracker {
    const url = arr2text(torrent.announce);
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
