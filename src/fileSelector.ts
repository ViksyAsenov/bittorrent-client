import readline from 'readline';
import {MultipleFileInfoInterface} from './types/Info';
import logger from './logger';
import formatBytes from './utils/formatBytes';

export async function selectFiles(
  info: MultipleFileInfoInterface
): Promise<number[]> {
  const files = info.files;

  logger.info('\nFiles in torrent:');

  files.forEach((file, i) => {
    const filePath = file.path.join('/');
    const size = formatBytes(file.length);

    logger.info(`  [${i}] ${filePath} (${size})`);
  });

  logger.info(`  [a] All files`);
  logger.info('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise(resolve => {
    rl.question(
      'Select files to download (e.g. "0,2,3" or press Enter/type "a" for all): ',
      answer => {
        rl.close();

        const trimmed = answer.trim().toLowerCase();

        if (trimmed === '' || trimmed === 'a' || trimmed === 'all') {
          resolve(files.map((_, i) => i));
          return;
        }

        const indices = trimmed
          .split(',')
          .map(s => parseInt(s.trim(), 10))
          .filter(n => !isNaN(n) && n >= 0 && n < files.length);

        const unique = [...new Set(indices)];

        if (unique.length === 0) {
          logger.info('No valid selection — downloading all files.');
          resolve(files.map((_, i) => i));
          return;
        }

        resolve(unique);
      }
    );
  });
}
