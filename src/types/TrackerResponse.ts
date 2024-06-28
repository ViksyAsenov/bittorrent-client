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
  peers: Uint8Array; // Consisting of multiples of 6 bytes. First 4 bytes are the IP address and last 2 bytes are the port number. All in network (big endian) notation.
}
