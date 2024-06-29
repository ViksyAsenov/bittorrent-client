interface MessagePayload {
  index: number;
  begin: number;
  block?: Buffer;
  length?: number;
}

export default MessagePayload;
