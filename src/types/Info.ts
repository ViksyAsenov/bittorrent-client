interface BasicInfo {
  name: string;
  'piece length': number;
  pieces: Buffer;
  private?: number;
}

export interface SingleFileInfo extends BasicInfo {
  length: number;
  md5sum?: string;
}

export interface MultipleFileInfo extends BasicInfo {
  files: {
    length: number;
    md5sum?: string;
    path: string[];
  }[];
}
