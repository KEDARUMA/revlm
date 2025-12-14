// Best-effort React Native setup: tries to load crypto/subtle/Buffer/TextEncoder/TextDecoder.
const safeRequire = (id: string): any => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(id);
  } catch {
    return undefined;
  }
};

const g: any = global;

// Prefer existing crypto; fill only missing pieces.
let cryptoGlobal: any = g.crypto;

// Fallback: use @peculiar/webcrypto (pure JS) when crypto or subtle is missing.
if (!cryptoGlobal || !cryptoGlobal.subtle) {
  const webcrypto = safeRequire('@peculiar/webcrypto');
  const CryptoCtor = webcrypto?.Crypto;
  const WebTextEncoder = webcrypto?.TextEncoder;
  const WebTextDecoder = webcrypto?.TextDecoder;
  if (CryptoCtor) {
    const wc = new CryptoCtor();
    if (!cryptoGlobal) {
      cryptoGlobal = wc;
      g.crypto = wc;
    } else if (!cryptoGlobal.subtle) {
      // Preserve existing crypto, add subtle + getRandomValues
      cryptoGlobal.subtle = wc.subtle;
      if (typeof cryptoGlobal.getRandomValues !== 'function') {
        cryptoGlobal.getRandomValues = wc.getRandomValues.bind(wc);
      }
    }
    if (WebTextEncoder && !g.TextEncoder) g.TextEncoder = WebTextEncoder;
    if (WebTextDecoder && !g.TextDecoder) g.TextDecoder = WebTextDecoder;
  }
}

// Polyfill random values for libraries like bson if still missing.
safeRequire('react-native-get-random-values');

// Polyfill TextEncoder/TextDecoder if provided by fast-text-encoding.
const fastTextEncoding = safeRequire('fast-text-encoding');
if (fastTextEncoding?.TextEncoder && !g.TextEncoder) {
  g.TextEncoder = fastTextEncoding.TextEncoder;
}
if (fastTextEncoding?.TextDecoder && !g.TextDecoder) {
  g.TextDecoder = fastTextEncoding.TextDecoder;
}

// Polyfill Buffer if provided.
const bufferModule = safeRequire('buffer');
const BufferCtor = bufferModule?.Buffer;
if (BufferCtor && !g.Buffer) {
  g.Buffer = BufferCtor;
}

export {};
