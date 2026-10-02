// CRC-32 (the zip one). The upload page (studio.js) sends it with each file, so the test pack (lib/zip.js) can stream
// the file from storage without reading every byte on the server. Pass the previous result as `crc` to continue.

const TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  TABLE[n] = c >>> 0;
}

export function crc32(bytes, crc = 0) {
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export const crcHex = n => (n >>> 0).toString(16).padStart(8, "0");
