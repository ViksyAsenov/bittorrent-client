export default interface MessagePayloadInterface {
  index: number;
  begin: number;
  block?: Buffer;
  length?: number;
}
