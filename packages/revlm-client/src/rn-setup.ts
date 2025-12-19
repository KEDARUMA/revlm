// Best-effort React Native setup: tries to load crypto/Buffer/TextEncoder/TextDecoder.
const safeRequire = (id: string): any => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id);
  } catch {
    return undefined;
  }
};

// Prefer existing crypto; if missing, try react-native-quick-crypto.
if (!(global as any).crypto) {
  const quickCrypto = safeRequire('react-native-quick-crypto');
  if (quickCrypto) (global as any).crypto = quickCrypto;
}

// Polyfill random values for libraries like bson.
safeRequire('react-native-get-random-values');

// Polyfill TextEncoder/TextDecoder if provided.
const fastTextEncoding = safeRequire('fast-text-encoding');
if (fastTextEncoding?.TextEncoder && !(global as any).TextEncoder) {
  (global as any).TextEncoder = fastTextEncoding.TextEncoder;
}
if (fastTextEncoding?.TextDecoder && !(global as any).TextDecoder) {
  (global as any).TextDecoder = fastTextEncoding.TextDecoder;
}

// Polyfill Buffer if provided.
const bufferModule = safeRequire('buffer');
const BufferCtor = bufferModule?.Buffer;
if (BufferCtor && !(global as any).Buffer) {
  (global as any).Buffer = BufferCtor;
}

export {};
