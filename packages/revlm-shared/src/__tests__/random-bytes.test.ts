import { getRandomBytes, initRandomBytes } from '../random-bytes';

describe('random-bytes', () => {
  afterEach(() => {
    // Reset to internal fallback between test cases.
    // 各テスト後に内部フォールバックへ戻す。
    initRandomBytes();
  });

  it('uses provided implementation when initialized', () => {
    const stub = jest.fn((length: number) => new Uint8Array(length).fill(0xab));
    initRandomBytes(stub);

    const out = getRandomBytes()(4);
    expect(Array.from(out)).toEqual([0xab, 0xab, 0xab, 0xab]);
    expect(stub).toHaveBeenCalledWith(4);
  });

  it('supports a custom function passed to initRandomBytes', () => {
    const myRandomBytes = (length: number): Uint8Array => {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) out[i] = (i + 1) & 0xff;
      return out;
    };

    initRandomBytes(myRandomBytes);
    expect(Array.from(getRandomBytes()(5))).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses internal fallback when initialized with undefined', () => {
    initRandomBytes(undefined);
    const out = getRandomBytes()(16);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(16);
  });
});
