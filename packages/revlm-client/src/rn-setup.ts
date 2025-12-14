// Best-effort React Native setup: tries to load crypto/Buffer/TextEncoder/TextDecoder.
const safeRequire = (id: string): any => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id);
  } catch {
    return undefined;
  }
};

// Ensure crypto.getRandomValues and crypto.subtle are available if provided by react-native-webcrypto.
const webcrypto = safeRequire('react-native-webcrypto');
const cryptoFromWebcrypto = webcrypto?.crypto;
if (cryptoFromWebcrypto && !(global as any).crypto) {
  (global as any).crypto = cryptoFromWebcrypto;
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
