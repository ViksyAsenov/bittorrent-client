export default interface TrackerRequestInterface {
  // Contains info_hash as well but should be added after url encoding has been done
  peer_id: string;
  port: string;
  uploaded: string;
  downloaded: string;
  left: string;
  compact: '0' | '1';
  event: 'started' | 'stopped' | 'completed';
  info_hash?: string;
}
