export interface Peer {
  ip: string;
  port: number;
}

export interface UdpTrackerResponse {
  action: number;
  transactionId: number;
  leechers: number;
  seeders: number;
  peers: Peer[];
}

export interface HttpTrackerResponse {
  interval: number;
  peers: Uint8Array;
}
