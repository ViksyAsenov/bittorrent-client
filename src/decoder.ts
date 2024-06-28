import {arr2text, text2arr} from './utils/uint8';

const INTEGER_START = 0x69; // 'i'
const STRING_DELIM = 0x3a; // ':'
const DICTIONARY_START = 0x64; // 'd'
const LIST_START = 0x6c; // 'l'
const END_OF_TYPE = 0x65; // 'e'

// Bencode decoder
// For more information on this format
// https://en.wikipedia.org/wiki/Bencode

class BencodeDecoder {
  private static position: number;
  private static data: Uint8Array;

  private constructor() {}

  private static getIntFromBuffer(
    buffer: Uint8Array,
    start: number,
    end: number
  ): number {
    let sum = 0;
    let sign = 1;

    for (let i = start; i < end; i++) {
      const num = buffer[i];

      if (num < 58 && num >= 48) {
        sum = sum * 10 + (num - 48);
        continue;
      }

      if (i === start && num === 43) {
        // +
        continue;
      }

      if (i === start && num === 45) {
        // -
        sign = -1;
        continue;
      }

      if (num === 46) {
        // .
        break; // it's a float
      }

      throw new Error('Not a number: buffer[' + i + '] = ' + num);
    }

    return sum * sign;
  }

  public static decode(
    data: Uint8Array | string,
    start?: number,
    end?: number
  ): unknown {
    if (data === null || (data instanceof Uint8Array && data.length === 0)) {
      return null;
    }

    this.position = 0;

    this.data = !(data instanceof Uint8Array)
      ? text2arr(data)
      : new Uint8Array(data.slice(start, end));

    return this.next();
  }

  private static next(): unknown {
    switch (this.data[this.position]) {
      case DICTIONARY_START:
        return this.decodeDictionary();
      case LIST_START:
        return this.decodeList();
      case INTEGER_START:
        return this.decodeInteger();
      default:
        return this.decodeBuffer();
    }
  }

  private static find(chr: number): number {
    let i = this.position;
    const c = this.data.length;
    const d = this.data;

    while (i < c) {
      if (d[i] === chr) return i;
      i++;
    }

    throw new Error(
      'Invalid data: Missing delimiter "' +
        String.fromCharCode(chr) +
        '" [0x' +
        chr.toString(16) +
        ']'
    );
  }

  private static decodeDictionary(): {[key: string]: unknown} {
    this.position++;

    const dict: {[key: string]: unknown} = {};

    while (this.data[this.position] !== END_OF_TYPE) {
      let key = this.decodeBuffer();

      if (typeof key !== 'string') {
        key = arr2text(key);
      }

      dict[key] = this.next();
    }

    this.position++;

    return dict;
  }

  private static decodeList(): unknown[] {
    this.position++;

    const lst: unknown[] = [];

    while (this.data[this.position] !== END_OF_TYPE) {
      lst.push(this.next());
    }

    this.position++;

    return lst;
  }

  private static decodeInteger(): number {
    const end = this.find(END_OF_TYPE);
    const number = this.getIntFromBuffer(this.data, this.position + 1, end);

    this.position += end + 1 - this.position;

    return number;
  }

  private static decodeBuffer(): string | Uint8Array {
    let sep = this.find(STRING_DELIM);
    const length = this.getIntFromBuffer(this.data, this.position, sep);
    const end = ++sep + length;

    const buffer = this.data.slice(sep, end);
    this.position = end;

    return this.tryDecodeBuffer(buffer);
  }

  private static tryDecodeBuffer(buffer: Uint8Array): string | Uint8Array {
    const text = arr2text(buffer);

    if (/[\uFFFD]/.test(text)) {
      return buffer;
    }

    return text;
  }
}

export default BencodeDecoder;
