import TorrentParser from './torrentParser';
import Downloader from './download';
import logger from './logger';

const torrent = TorrentParser.open(process.argv[2]);
const downloader = new Downloader(torrent, torrent.info.name);

downloader.download();

process.on('uncaughtException', error => {
  logger.error(`Uncaught exception: ${error.message}`);
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  logger.error(`Unhandled rejection: ${reason}`);
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
});
