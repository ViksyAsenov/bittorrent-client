import TorrentParser from './torrentParser';
import Downloader from './download';

const torrent = TorrentParser.open(process.argv[2]);
const downloader = new Downloader(torrent);

downloader.download();
