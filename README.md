# BitTorrent Client - ViksyTorrent

The ViksyTorrent client is a simple implementation that adheres to the BitTorrent protocol specifications. It currently only supports torrents with a single file.

## Features

- **Torrent Parsing:** Supports parsing of `.torrent` files to extract necessary information.
- **Tracker Communication:** Communicates with trackers to obtain a list of peers.
- **Peer-to-Peer Communication:** Establishes connections with peers and exchanges messages according to the BitTorrent protocol.
- **Piece Management:** Manages downloaded and requested pieces of the torrent file.

## Usage

 Clone the repository:

```bash
git clone https://github.com/ViksyAsenov/bittorrent-client
```

Install the dependencies:
```bash
npm install
```

Start the client with the path to the .torrent file
```bash
npm start /path/to/your/torrent-file.torrent
```

And thats it! The file within the torrent will be downloaded in the project's directory!



