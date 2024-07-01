let twelveDigitNumber: number | null = null;

// peerId uses the following encoding:
// '-', two characters for client id, four ascii digits for version number, '-'
// followed by random numbers until length of 20
export default function generatePeerId(): Buffer {
  if (!twelveDigitNumber) {
    twelveDigitNumber = Math.floor(
      100_000_000_000 + Math.random() * 900_000_000_000
    );
  }

  return Buffer.from(`-VT2006-${twelveDigitNumber}`);
}
