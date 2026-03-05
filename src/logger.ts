class Logger {
  private totalSize: number;
  private downloadedBytes: number;
  private startTime: number;
  private lastUpdateTime: number;
  private lastDownloadedBytes: number;
  private speedSamples: number[] = [];
  private connectedPeers = 0;
  private disconnectedPeers = 0;

  constructor() {
    this.totalSize = 0;
    this.downloadedBytes = 0;
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();
    this.lastDownloadedBytes = 0;
  }

  startDownload(totalSize: number) {
    this.totalSize = totalSize;
    this.startTime = Date.now();
    this.lastUpdateTime = Date.now();
    this.downloadedBytes = 0;
    this.lastDownloadedBytes = 0;
    this.speedSamples = [];

    console.log('\n');
  }

  onBlockReceived(bytes: number) {
    this.downloadedBytes += bytes;
    this.updateSpeed();
  }

  private updateSpeed() {
    const now = Date.now();
    const elapsedSinceLastUpdate = now - this.lastUpdateTime;

    if (elapsedSinceLastUpdate >= 1000) {
      const bytesInWindow = this.downloadedBytes - this.lastDownloadedBytes;
      const speed = bytesInWindow / (elapsedSinceLastUpdate / 1000);

      this.speedSamples.push(speed);
      if (this.speedSamples.length > 5) {
        this.speedSamples.shift();
      }

      this.lastUpdateTime = now;
      this.lastDownloadedBytes = this.downloadedBytes;
    }
  }

  private getAverageSpeed(): number {
    if (this.speedSamples.length === 0) return 0;
    const sum = this.speedSamples.reduce((a, b) => a + b, 0);
    return sum / this.speedSamples.length;
  }

  setPeerCounts(connected: number, disconnected: number) {
    this.connectedPeers = connected;
    this.disconnectedPeers = disconnected;
  }

  printProgress() {
    const percent = (this.downloadedBytes / this.totalSize) * 100;
    const barLength = 30;
    const filledLength = Math.round((barLength * percent) / 100);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);

    const speed = this.getAverageSpeed();
    const speedText = this.formatBytes(speed) + '/s';

    const totalDigits = String(this.totalSize).length;
    const remainingText = `${String(this.totalSize - this.downloadedBytes).padStart(totalDigits)} bytes left`;

    let etaText = 'ETA: --';
    if (speed > 0) {
      const remainingBytes = this.totalSize - this.downloadedBytes;
      const etaSeconds = Math.floor(remainingBytes / speed);
      etaText = `ETA: ${this.formatTime(etaSeconds)}`;
    }

    const peerText = `${this.connectedPeers} peers`;
    const droppedText =
      this.disconnectedPeers > 0 ? `${this.disconnectedPeers} dropped` : '';
    const peerInfo = droppedText ? `${peerText}  │  ${droppedText}` : peerText;

    this.clearLine();
    process.stdout.write(
      `\r${bar}  ${percent.toFixed(2)}%  │  ${remainingText}  │  ${speedText.padStart(10)}  │  ${etaText}  │  ${peerInfo}`
    );
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';

    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private formatTime(seconds: number): string {
    if (seconds === Infinity) return '--';

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    let res = '';

    if (hrs > 0) {
      res += `${hrs}h `;
    }
    if (mins > 0 || hrs > 0) {
      res += `${mins}m `;
    }

    res += `${secs}s`;

    return res;
  }

  info(message: string) {
    this.clearLine();

    console.log(`\x1b[36m[INFO]\x1b[0m ${message}`);

    if (this.totalSize > 0) {
      this.printProgress();
    }
  }

  error(message: string) {
    this.clearLine();

    console.error(`\x1b[31m[ERROR]\x1b[0m ${message}`);

    if (this.totalSize > 0) {
      this.printProgress();
    }
  }

  success(message: string) {
    this.clearLine();

    console.log(`\x1b[32m[SUCCESS]\x1b[0m ${message}`);

    if (this.totalSize > 0) {
      this.printProgress();
    }
  }

  downloadComplete() {
    this.clearLine();

    const totalTime = (Date.now() - this.startTime) / 1000;
    const avgSpeed = this.totalSize / totalTime;

    this.success(
      `Download complete in ${this.formatTime(Math.floor(totalTime))}!`
    );

    this.info(`Average speed: ${this.formatBytes(avgSpeed)}/s`);
  }

  private clearLine() {
    process.stdout.write('\x1b[2K\r');
  }
}

const logger = new Logger();

export default logger;
