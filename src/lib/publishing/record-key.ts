// https://atproto.com/specs/tid — valid sortable keys, saved before a write.
const ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';
let lastMicros = 0n;
let clock: bigint | undefined;

export function newRecordKey(): string {
  clock ??= BigInt(crypto.getRandomValues(new Uint16Array(1))[0] & 1023);
  const micros = BigInt(Date.now()) * 1000n;
  lastMicros = micros > lastMicros ? micros : lastMicros + 1n;
  let value = (lastMicros << 10n) | clock;
  let key = '';
  for (let i = 0; i < 13; i++) {
    key = ALPHABET[Number(value & 31n)] + key;
    value >>= 5n;
  }
  return key;
}
