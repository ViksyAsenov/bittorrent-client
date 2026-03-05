export default interface TrackerRequestInterface {
  peer_id: string;
  port: string;
  uploaded: string;
  downloaded: string;
  left: string;
  compact: '0' | '1';
  event: 'started' | 'stopped' | 'completed';
  info_hash?: string;
}
