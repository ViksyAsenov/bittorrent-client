interface BasicInfoInterface {
  name: string;
  'piece length': number;
  pieces: Buffer;
  private?: number;
}

export interface SingleFileInfoInterface extends BasicInfoInterface {
  length: number;
  md5sum?: string;
}

export interface MultipleFileInfoInterface extends BasicInfoInterface {
  files: {
    length: number;
    md5sum?: string;
    path: string[];
  }[];
}
