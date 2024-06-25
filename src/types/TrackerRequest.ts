interface TrackerRequest {
  info_hash: string;
  peer_id: string;
  port: number;
  uploaded: number;
  downloaded: number;
  left: number;
  compact: 0 | 1;
  event: 'started' | 'stopped' | 'completed';
  numwant?: number;
  key?: string;
  trackerId?: number;
}

export default TrackerRequest;
