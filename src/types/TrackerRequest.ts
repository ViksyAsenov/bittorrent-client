interface TrackerRequest extends Record<string, string> {
  // Contains info_hash as well but after encoding it will throw an error, so add after url encoding
  peer_id: string;
  port: string;
  uploaded: string;
  downloaded: string;
  left: string;
  compact: '0' | '1';
  event: 'started' | 'stopped' | 'completed';
}

export default TrackerRequest;
