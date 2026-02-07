// Minimal fast-base64-decode shim for Metro CJS interop.
// MetroのCJS互換のためのfast-base64-decode最小シム。
function fastBase64Decode(input) {
  return Buffer.from(String(input || ''), 'base64');
}

module.exports = fastBase64Decode;
module.exports.default = fastBase64Decode;
