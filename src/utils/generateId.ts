let randomTenDigitNumber: number | null = null;

export default function generateId(): Buffer {
  if (!randomTenDigitNumber) {
    randomTenDigitNumber = Math.floor(1000000000 + Math.random() * 9000000000);
  }

  return Buffer.from(`-ViksyBTC-${randomTenDigitNumber}`);
}
