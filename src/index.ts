import TorrentParser from './torrentParser';
import Downloader from './download';

const torrent = TorrentParser.open(process.argv[2]);
const downloader = new Downloader(torrent, torrent.info.name);

downloader.download();

process.on('uncaughtException', error => {
  console.error(`Uncaught exception: ${error.message}`);
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  console.error(`Unhandled rejection: ${reason}`);
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
});
