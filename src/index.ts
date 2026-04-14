import path from 'path';
import TorrentParser from './torrentParser';
import Downloader from './download';
import logger from './logger';
import parseMagnetUri from './magnetParser';
import TrackerBuilder from './tracker';
import {fetchMetadata, buildTorrentFromMetadata} from './metadataExchange';
import {PeerInterface} from './types/TrackerResponse';
import TorrentInterface from './types/Torrent';
import {selectFiles} from './fileSelector';
import isMultiFileInfo from './utils/isMultiFileInfo';

const input = process.argv[2];
const saveDir = process.argv[3] || process.cwd();

if (!input) {
  logger.error(
    'Usage: ts-node src/index.ts <torrent-file-or-magnet-link> [save-location]'
  );
  // eslint-disable-next-line n/no-process-exit
  process.exit(1);
}

if (input.startsWith('magnet:')) {
  startFromMagnet(input);
} else {
  startFromTorrentFile(input);
}

async function startFromTorrentFile(filePath: string) {
  try {
    const torrent = TorrentParser.open(filePath);
    let selectedFileIndices: number[] | undefined;

    if (isMultiFileInfo(torrent.info)) {
      selectedFileIndices = await selectFiles(torrent.info);
    }

    const downloader = new Downloader(
      torrent,
      path.join(saveDir, torrent.info.name),
      selectedFileIndices
    );

    downloader.download();
  } catch (error) {
    logger.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`
    );
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  }
}

async function startFromMagnet(magnetUri: string) {
  try {
    const magnet = parseMagnetUri(magnetUri);

    logger.info(`Magnet link parsed: ${magnet.displayName || magnet.infoHash}`);
    logger.info(`Info hash: ${magnet.infoHash}`);
    logger.info(`Trackers: ${magnet.trackers.length}`);

    if (magnet.trackers.length === 0) {
      logger.error('No trackers in magnet link. Cannot discover peers.');
      // eslint-disable-next-line n/no-process-exit
      process.exit(1);
    }

    logger.info('Contacting trackers to find peers...');

    const tracker = TrackerBuilder.buildFromMagnet(
      magnet.infoHash,
      magnet.trackers
    );

    const peers = await new Promise<PeerInterface[]>(resolve => {
      tracker.getPeers(resolve);
    });

    if (peers.length === 0) {
      logger.error('No peers found from trackers.');
      // eslint-disable-next-line n/no-process-exit
      process.exit(1);
    }

    logger.info(`Found ${peers.length} peers. Fetching metadata...`);

    // Fetch metadata from peers using BEP 9
    const metadataBuffer = await fetchMetadata(magnet.infoHash, peers);

    const torrent = buildTorrentFromMetadata(
      magnet.infoHash,
      metadataBuffer,
      magnet.trackers,
      magnet.displayName
    ) as unknown as TorrentInterface;

    const downloadName =
      torrent.info.name || magnet.displayName || magnet.infoHash;

    let selectedFileIndices: number[] | undefined;
    if (isMultiFileInfo(torrent.info)) {
      selectedFileIndices = await selectFiles(torrent.info);
    }

    logger.info(`Starting download: ${downloadName}`);

    const downloader = new Downloader(
      torrent,
      path.join(saveDir, downloadName),
      selectedFileIndices
    );

    downloader.download();
  } catch (error) {
    logger.error(
      `Magnet link error: ${error instanceof Error ? error.message : String(error)}`
    );
    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  }
}

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
