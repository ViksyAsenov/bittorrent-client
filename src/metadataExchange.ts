// BEP 9: Extension for Peers to Send Metadata Files
// Fetches torrent metadata (info dict) from peers using the ut_metadata extension
// http://www.bittorrent.org/beps/bep_0009.html

import net, {Socket} from 'net';
import crypto from 'crypto';
import {PeerInterface} from './types/TrackerResponse';
import MessageHandler from './message';
import BencodeDecoder from './decoder';
import logger from './logger';

const METADATA_PIECE_SIZE = 16384; // BEP 9 standard size
const PEER_TIMEOUT_MS = 15000;
const MAX_CONCURRENT = 30;

export function fetchMetadata(
  infoHashHex: string,
  peers: PeerInterface[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let resolved = false;
    let activeCount = 0;
    let nextPeerIndex = 0;
    const totalPeers = peers.length;
    const activeSockets: Set<Socket> = new Set();

    // Shuffle peers to avoid everyone hammering the same ones
    const shuffled = [...peers];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    function cleanupAll() {
      for (const s of activeSockets) {
        if (!s.destroyed) s.destroy();
      }

      activeSockets.clear();
    }

    function onPeerResult(result: Buffer | null, socket: Socket) {
      activeSockets.delete(socket);

      if (resolved) return;

      activeCount--;

      if (result !== null && result !== undefined) {
        resolved = true;

        cleanupAll();
        resolve(result);

        return;
      }

      launchNext();

      if (activeCount === 0 && nextPeerIndex >= totalPeers) {
        resolved = true;

        reject(
          new Error(`Failed to fetch metadata from any of ${totalPeers} peers`)
        );
      }
    }

    function launchNext() {
      while (
        !resolved &&
        activeCount < MAX_CONCURRENT &&
        nextPeerIndex < totalPeers
      ) {
        const peer = shuffled[nextPeerIndex++];

        activeCount++;

        const socket = fetchMetadataFromPeer(infoHashHex, peer, (result, s) => {
          onPeerResult(result, s);
        });

        activeSockets.add(socket);
      }
    }

    launchNext();

    if (totalPeers === 0) {
      reject(new Error('No peers to fetch metadata from'));
    }
  });
}

function fetchMetadataFromPeer(
  infoHashHex: string,
  peer: PeerInterface,
  callback: (result: Buffer | null, socket: Socket, error?: string) => void
): Socket {
  let settled = false;
  const peerKey = `${peer.ip}:${peer.port}`;

  const socket = net.createConnection({
    host: peer.ip,
    port: peer.port,
    timeout: PEER_TIMEOUT_MS,
  });

  function done(result: Buffer | null, error?: string) {
    if (settled) return;

    settled = true;

    clearTimeout(timeout);

    if (!socket.destroyed) socket.destroy();

    if (error) {
      logger.error(`Peer ${peerKey}: ${error}`);
    }

    callback(result, socket, error);
  }

  const timeout = setTimeout(() => {
    done(null, 'Timed out');
  }, PEER_TIMEOUT_MS);

  let handshakeDone = false;
  let peerUtMetadataId = 0;
  let metadataSize = 0;
  const metadataPieces: Map<number, Buffer> = new Map();
  let totalPieces = 0;

  const chunks: Buffer[] = [];
  let totalLength = 0;
  let expectingHandshake = true;

  socket.on('connect', () => {
    socket.write(MessageHandler.buildHandshakeFromHash(infoHashHex));
  });

  socket.on('timeout', () => {
    done(null, 'Socket timeout');
  });

  socket.on('data', (data: Buffer) => {
    if (settled) return;

    chunks.push(data);
    totalLength += data.length;

    // eslint-disable-next-line no-constant-condition
    while (!settled) {
      if (expectingHandshake && totalLength < 1) break;

      if (!expectingHandshake && totalLength < 4) break;

      const savedBuffer = Buffer.concat(chunks);

      chunks.length = 0;
      chunks.push(savedBuffer);

      if (expectingHandshake) {
        if (totalLength < 68) break; // Need full handshake

        const message = savedBuffer.slice(0, 68);

        chunks.length = 0;
        chunks.push(savedBuffer.slice(68));
        totalLength -= 68;
        expectingHandshake = false;

        if (!MessageHandler.isHandshakeForHash(message, infoHashHex)) {
          done(null, 'Info hash mismatch');

          return;
        }

        if (!MessageHandler.peerSupportsExtension(message)) {
          done(null, 'No BEP 10 support');

          return;
        }

        handshakeDone = true;
        socket.write(MessageHandler.buildExtensionHandshake());

        continue;
      }

      // Non-handshake message
      const messageLength = savedBuffer.readInt32BE(0) + 4;

      if (messageLength === 4) {
        // Keep-alive
        chunks.length = 0;
        chunks.push(savedBuffer.slice(4));
        totalLength -= 4;

        continue;
      }

      if (messageLength < 4 || messageLength > 1024 * 1024) {
        done(null, `Invalid message length: ${messageLength}`);

        return;
      }

      if (totalLength < messageLength) break;

      const message = savedBuffer.slice(0, messageLength);

      chunks.length = 0;
      chunks.push(savedBuffer.slice(messageLength));
      totalLength -= messageLength;

      try {
        handleMessage(message);
      } catch (error) {
        done(
          null,
          `Message error: ${error instanceof Error ? error.message : String(error)}`
        );

        return;
      }
    }
  });

  function handleMessage(message: Buffer) {
    if (message.length < 5) return;

    const msgId = message.readUInt8(4);

    // We only care about extended messages (ID 20)
    if (msgId !== 20) return;

    const payload = message.slice(5);
    const parsed = MessageHandler.parseExtensionMessage(payload);

    if (!parsed) {
      return;
    }

    if (parsed.extensionId === 0) {
      handleExtensionHandshake(parsed.dict);
    } else if (peerUtMetadataId > 0) {
      handleMetadataResponse(parsed.dict, parsed.trailing);
    }
  }

  function handleExtensionHandshake(dict: Record<string, unknown>) {
    const m = dict.m as Record<string, number> | undefined;
    const ms = dict.metadata_size as number | undefined;

    if (!m || !m.ut_metadata) {
      done(null, 'No ut_metadata support');

      return;
    }

    if (!ms || ms <= 0) {
      done(null, 'No metadata_size');

      return;
    }

    peerUtMetadataId = m.ut_metadata;
    metadataSize = ms;
    totalPieces = Math.ceil(metadataSize / METADATA_PIECE_SIZE);

    logger.info(
      `Peer ${peerKey} has metadata (${metadataSize} bytes, ${totalPieces} pieces)`
    );

    for (let i = 0; i < totalPieces; i++) {
      if (socket.writable && !settled) {
        socket.write(MessageHandler.buildMetadataRequest(peerUtMetadataId, i));
      }
    }
  }

  function handleMetadataResponse(
    dict: Record<string, unknown>,
    trailing: Buffer
  ) {
    const msgType = dict.msg_type as number;
    const piece = dict.piece as number;

    if (msgType === 2) {
      done(null, `Rejected metadata piece ${piece}`);

      return;
    }

    if (msgType !== 1) return;

    metadataPieces.set(piece, trailing);

    if (metadataPieces.size === totalPieces) {
      // Reassemble all pieces in order
      const pieces: Buffer[] = [];
      for (let i = 0; i < totalPieces; i++) {
        const p = metadataPieces.get(i);

        if (!p) {
          done(null, `Missing metadata piece ${i}`);

          return;
        }

        pieces.push(p);
      }

      const fullMetadata = Buffer.concat(pieces);

      const hash = crypto.createHash('sha1').update(fullMetadata).digest('hex');

      if (hash !== infoHashHex) {
        done(null, `Hash mismatch: expected ${infoHashHex}, got ${hash}`);

        return;
      }

      logger.success('Metadata fetched and verified!');

      done(fullMetadata);
    }
  }

  socket.on('error', (error: Error) => {
    done(null, `Connection error: ${error.message}`);
  });

  socket.on('close', () => {
    if (!settled) {
      done(
        null,
        handshakeDone
          ? `Closed (got ${metadataPieces.size}/${totalPieces || '?'} pieces)`
          : 'Closed before handshake'
      );
    }
  });

  return socket;
}

export function buildTorrentFromMetadata(
  infoHashHex: string,
  metadataBuffer: Buffer,
  trackers: string[],
  displayName?: string
): {
  info: Record<string, unknown>;
  announce?: string;
  'announce-list'?: string[][];
  infoHash: string;
} {
  const info = BencodeDecoder.decode(metadataBuffer) as Record<string, unknown>;

  if (!info.name && displayName) {
    info.name = displayName;
  }

  const torrent: {
    info: Record<string, unknown>;
    announce?: string;
    'announce-list'?: string[][];
    infoHash: string;
  } = {
    info,
    infoHash: infoHashHex,
  };

  if (trackers.length > 0) {
    torrent.announce = trackers[0];
    torrent['announce-list'] = trackers.map(t => [t]);
  }

  return torrent;
}
