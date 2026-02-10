export type RandomBytesFn = (length: number) => Uint8Array;

function createFallbackRandomBytes(): RandomBytesFn {
  // Xorshift128+ seeded from coarse runtime entropy.
  // 粗い実行時エントロピーを使った Xorshift128+。
  let seedA = BigInt(Date.now()) ^ BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  let seedB = (seedA << 13n) ^ 0x9e3779b97f4a7c15n;
  const mask64 = (1n << 64n) - 1n;
  if (seedA === 0n) seedA = 0x243f6a8885a308d3n;
  if (seedB === 0n) seedB = 0x13198a2e03707344n;

  const nextU64 = (): bigint => {
    let x = seedA;
    const y = seedB;
    seedA = y;
    x ^= (x << 23n) & mask64;
    x ^= x >> 17n;
    x ^= y;
    x ^= y >> 26n;
    seedB = x & mask64;
    return (seedB + y) & mask64;
  };

  return (length: number): Uint8Array => {
    if (!Number.isInteger(length) || length < 0) {
      throw new Error(`randomBytes length must be a non-negative integer: ${length}`);
    }
    const out = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      const value = nextU64();
      for (let i = 0; i < 8 && offset < length; i += 1) {
        out[offset] = Number((value >> BigInt(i * 8)) & 0xffn);
        offset += 1;
      }
    }
    return out;
  };
}

let randomBytesImpl: RandomBytesFn = createFallbackRandomBytes();

export function initRandomBytes(randomBytes?: RandomBytesFn): void {
  randomBytesImpl = randomBytes ?? createFallbackRandomBytes();
}

export function getRandomBytes(): RandomBytesFn {
  return randomBytesImpl;
}

