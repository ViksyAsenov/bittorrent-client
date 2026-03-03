export interface PeerInterface {
  ip: string;
  port: number;
}

export interface UdpTrackerResponseInterface {
  action: number;
  transactionId: number;
  leechers: number;
  seeders: number;
  peers: PeerInterface[];
}

export interface HttpTrackerResponseInterface {
  interval: number;
  peers: Uint8Array; // Consisting of multiples of 6 bytes. First 4 bytes are the IP address and last 2 bytes are the port number. All in network (big endian) notation.
}
