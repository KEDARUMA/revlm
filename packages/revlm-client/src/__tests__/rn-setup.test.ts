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

  it('sets globals when optional deps are available', () => {
    jest.doMock('react-native-webcrypto', () => ({
      crypto: { subtle: { importKey: jest.fn() }, getRandomValues: jest.fn() },
    }), { virtual: true });
    jest.doMock('react-native-get-random-values', () => ({}), { virtual: true });
    jest.doMock('fast-text-encoding', () => ({
      TextEncoder: class MockTextEncoder {},
      TextDecoder: class MockTextDecoder {},
    }), { virtual: true });
    jest.doMock('buffer', () => ({
      Buffer: class MockBuffer {},
    }), { virtual: true });

    jest.isolateModules(() => {
      require('../rn-setup');
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = global;
    expect(g.crypto).toBeDefined();
    expect(g.crypto.subtle).toBeDefined();
    expect(g.TextEncoder?.name).toBe('MockTextEncoder');
    expect(g.TextDecoder?.name).toBe('MockTextDecoder');
    expect(g.Buffer?.name).toBe('MockBuffer');
  });

  it('does not throw when optional deps are missing', () => {
    expect(() => {
      jest.isolateModules(() => {
        require('../rn-setup');
      });
    }).not.toThrow();
  });
});
