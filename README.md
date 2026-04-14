# BitTorrent Client — ViksyTorrent

A fully functional, terminal-based BitTorrent client built from scratch in TypeScript. No third-party BitTorrent libraries — every part of the protocol is implemented by hand, from Bencode serialization to peer wire messaging.

## Features

- **`.torrent` file & magnet link support** — download from either a `.torrent` file or a `magnet:?` URI
- **UDP & HTTP tracker communication** — announces to both UDP and HTTP trackers following the official specs, with multi-tracker support (BEP 12)
- **Full peer wire protocol** — handshake, choke/unchoke, interested, bitfield, have, request, piece, cancel, keep-alive
- **Magnet link metadata exchange** — fetches torrent metadata from peers using BEP 9 (ut_metadata) and BEP 10 (Extension Protocol)
- **Rarest-first piece selection** — prioritizes downloading the least available pieces across the swarm, with randomized tie-breaking via Fisher-Yates shuffle to avoid herding
- **Endgame mode** — when only a few blocks remain, requests are sent to all peers simultaneously; CANCEL messages are broadcast to all peers on every received block to cut redundant in-flight requests
- **Pipelined requests** — up to 50 concurrent block requests per peer (5 during endgame) to maximize throughput
- **Multi-file torrent support** — correctly handles torrents containing multiple files and nested directory structures
- **Selective file download** — for multi-file torrents, interactively choose which files to download; pieces that touch only skipped files are never requested
- **Custom save location** — optionally specify where downloaded files are saved; defaults to the current working directory
- **Seeding** — responds to incoming REQUEST messages so the client gives back to the swarm
- **Live progress bar** — real-time terminal display with download speed, ETA, peer count, and a progress bar
- **Custom Bencode codec** — hand-written encoder and decoder with support for strings, integers, lists, and dictionaries
- **Peer lifecycle management** — automatic reconnection via tracker re-announces, peer bitfield tracking, and cleanup on disconnect

## How It Works

```
+--------------+     +--------------+     +--------------+     +--------------+
| .torrent /   |     |   Tracker    |     |    Peers     |     |  File System |
| magnet link  +---->+  (UDP/HTTP)  +---->+  (TCP P2P)   +---->+   (output)   |
+--------------+     +--------------+     +--------------+     +--------------+
```

1. **Parse input** — the client parses a `.torrent` file (Bencode-decoded) or a magnet URI to extract the info hash, tracker URLs, and file metadata.
2. **Contact trackers** — sends announce requests to UDP/HTTP trackers to discover peers in the swarm. For magnet links, metadata is first fetched from peers via BEP 9.
3. **Connect to peers** — opens TCP connections, performs the BitTorrent handshake, and exchanges bitfields to learn what each peer has.
4. **Download pieces** — requests blocks using a rarest-first strategy, pipelines up to 50 requests per peer, and writes completed blocks to disk. Enters endgame mode near completion.
5. **Seed** — serves blocks to other peers that request them, contributing back to the swarm.

## Interesting Implementation Details

### Rarest-First with Shuffle

The piece selection algorithm tracks piece availability across all connected peers. When requesting, it sorts by ascending availability and applies a Fisher-Yates shuffle among the rarest bucket — this prevents all clients from hammering the same single rarest piece.

### Endgame Mode

When the remaining unreceived blocks drops low enough (≤20 blocks or all remaining blocks have been requested), the client enters endgame mode. In this mode, every missing block is requested from all available peers simultaneously (with a reduced pipeline of 5). When a block arrives, a CANCEL message is broadcast to all other peers to cut redundant traffic. Note: CANCEL messages are actually sent on every received block throughout the entire download, not just during endgame — in endgame they become meaningful because the same block was intentionally requested from multiple peers.

### Custom Message Framing

TCP delivers a byte stream, not messages. The `onWholeMessage` method accumulates incoming data and performs length-prefix framing — reading the handshake length (pstrlen + 49 bytes) for the first message, then switching to 4-byte big-endian length prefixes for all subsequent messages. Keep-alive (zero-length) messages are silently consumed.

### Bencode Codec

Both the encoder and decoder are written from scratch with no dependencies. The decoder handles the full Bencode spec (integers, byte strings, lists, dictionaries) and uses a heuristic to decide whether a byte string should be returned as a UTF-8 string or raw `Uint8Array` (presence of replacement character `\uFFFD`). The encoder supports Maps, Sets, and ArrayBufferViews in addition to plain objects and arrays.

### Zero External BitTorrent Dependencies

The only runtime dependency is `bignum` — used for encoding 64-bit torrent sizes into 8-byte big-endian buffers for tracker announces. Everything else (Bencode, peer wire protocol, tracker protocol, metadata exchange) is implemented from scratch.

## Usage

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)

### Setup

```bash
git clone https://github.com/ViksyAsenov/bittorrent-client
cd bittorrent-client
npm install
```

### Download from a `.torrent` file

```bash
npm run download /path/to/file.torrent
```

### Download from a magnet link

```bash
npm run download "magnet:?xt=urn:btih:..."
```

### Specify a save location

```bash
npm run download /path/to/file.torrent /path/to/save/dir
npm run download "magnet:?xt=urn:btih:..." /path/to/save/dir
```

If omitted, files are saved in the current working directory.

### Selective file download

For multi-file torrents, the client will list all files and prompt you to choose which to download:

```
Files in torrent:
  [0] video/movie.mkv (4.2 GB)
  [1] subs/english.srt (52 KB)
  [2] subs/french.srt (49 KB)
  [a] All files

Select files to download (e.g. "0,2" or press Enter/type "a" for all):
```

Enter comma-separated indices, `a`, or press Enter to download everything.

### Run tests

```bash
npm test
```

## Project Structure

```
src/
- index.ts              # Entry point — routes .torrent vs magnet flows, handles file selection
- fileSelector.ts       # Interactive CLI prompt for selecting files in multi-file torrents
- download.ts           # Core download engine — peer management, piece requests, file I/O
- pieces.ts             # Piece/block tracking — rarest-first, endgame detection
- tracker.ts            # UDP & HTTP tracker communication (BEP 12)
- message.ts            # Peer wire protocol message builder & parser (BEP 3, 10)
- metadataExchange.ts   # BEP 9 — fetch torrent metadata from peers via ut_metadata
- magnetParser.ts       # Magnet URI parser (hex & Base32 info hashes)
- torrentParser.ts      # .torrent file parser — sizes, piece/block calculations
- encoder.ts            # Bencode encoder
- decoder.ts            # Bencode decoder
- queue.ts              # Per-peer block request queue
- logger.ts             # Terminal progress bar & logging
- types/                # TypeScript interfaces
- ...
- utils/
- - uint8.ts           # Uint8Array helpers
- - generatePeerId.ts  # Random 20-byte peer ID generation
- - isMultiFileInfo.ts # Multi-file torrent detection
- tests/                 # Jest test suite
- - decoder.test.ts
- - encoder.test.ts
- - message.test.ts
- - extensionMessage.test.ts
- - torrentParser.test.ts
- - magnetParser.test.ts
- - pieces.test.ts
- - download.test.ts
- - endgame.test.ts
```

## Specs Implemented

| BEP                                                    | Name                                       | Description                                                   |
| ------------------------------------------------------ | ------------------------------------------ | ------------------------------------------------------------- |
| [BEP 3](http://www.bittorrent.org/beps/bep_0003.html)  | The BitTorrent Protocol                    | Core protocol — handshake, peer wire messages, piece exchange |
| [BEP 9](http://www.bittorrent.org/beps/bep_0009.html)  | Extension for Peers to Send Metadata Files | Fetching `.torrent` metadata from peers (magnet link support) |
| [BEP 10](http://www.bittorrent.org/beps/bep_0010.html) | Extension Protocol                         | Extension handshake for negotiating protocol extensions       |
| [BEP 12](http://www.bittorrent.org/beps/bep_0012.html) | Multitracker Metadata Extension            | Multi-tier tracker announce support                           |
| [BEP 15](http://www.bittorrent.org/beps/bep_0015.html) | UDP Tracker Protocol                       | Compact UDP-based tracker communication                       |
