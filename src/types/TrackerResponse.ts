export interface Peer {
  ip: string;
  port: number;
}

interface TrackerResponse {
  action: number;
  transactionId: number;
  leechers: number;
  seeders: number;
  peers: Peer[];
}

export default TrackerResponse;
