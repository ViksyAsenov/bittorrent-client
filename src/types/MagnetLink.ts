export interface MagnetLinkInterface {
  infoHash: string; // 40-char lowercase hex
  displayName?: string;
  trackers: string[];
}
