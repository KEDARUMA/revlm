import { jest } from '@jest/globals';

const resetGlobals = () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = global;
  g.crypto = undefined;
  g.TextEncoder = undefined;
  g.TextDecoder = undefined;
  g.Buffer = undefined;
};

describe('rn-setup', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    resetGlobals();
  });

  it('keeps existing globals when already defined', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = global;
    g.crypto = { mock: true };
    g.TextEncoder = class MockTextEncoder {};
    g.TextDecoder = class MockTextDecoder {};
    g.Buffer = class MockBuffer {};

    await jest.isolateModulesAsync(async () => {
      await import('../rn-setup');
    });

    expect(g.crypto).toBeDefined();
    expect(g.TextEncoder?.name).toBe('MockTextEncoder');
    expect(g.TextDecoder?.name).toBe('MockTextDecoder');
    expect(g.Buffer?.name).toBe('MockBuffer');
  });

  it('does not throw when optional deps are missing', async () => {
    await expect(
      jest.isolateModulesAsync(async () => {
        await import('../rn-setup');
      }),
    ).resolves.not.toThrow();
  });
});
