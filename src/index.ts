import TorrentParser from './torrentParser';
import TrackerBuilder from './tracker';
import {Peer} from './types/TrackerResponse';

const torrent = TorrentParser.open(process.argv[2]);

const tracker = TrackerBuilder.buildTracker(torrent);

tracker.getPeers((peers: Peer[]) => {
  console.log('list of peers: ', peers);
});
