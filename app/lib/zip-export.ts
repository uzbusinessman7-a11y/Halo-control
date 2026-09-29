export type ZipFile = {
  name: string;
  content: string | Uint8Array;
};

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(value: Date) {
  const year = Math.max(1980, value.getFullYear());
  return {
    time: ((value.getHours() & 0x1f) << 11)
      | ((value.getMinutes() & 0x3f) << 5)
      | ((Math.floor(value.getSeconds() / 2)) & 0x1f),
    date: (((year - 1980) & 0x7f) << 9)
      | (((value.getMonth() + 1) & 0x0f) << 5)
      | (value.getDate() & 0x1f),
  };
}

function joinBytes(parts: Uint8Array[]) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

export function createZipArchive(files: ZipFile[], modifiedAt = new Date()) {
  if (!files.length) throw new Error("ZIP uchun kamida bitta fayl kerak.");
  if (files.length > 65_535) throw new Error("ZIP ichida fayllar soni juda ko‘p.");

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  const stamp = dosDateTime(modifiedAt);
  let localOffset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name.replace(/^\/+/, ""));
    const content = typeof file.content === "string" ? encoder.encode(file.content) : file.content;
    if (!name.byteLength || name.byteLength > 65_535) throw new Error("ZIP fayl nomi noto‘g‘ri.");
    if (content.byteLength > 0xffffffff) throw new Error("ZIP fayl hajmi juda katta.");
    const checksum = crc32(content);

    const localHeader = new Uint8Array(30 + name.byteLength);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, stamp.time, true);
    localView.setUint16(12, stamp.date, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, content.byteLength, true);
    localView.setUint32(22, content.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    localView.setUint16(28, 0, true);
    localHeader.set(name, 30);
    localParts.push(localHeader, content);

    const centralHeader = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, stamp.time, true);
    centralView.setUint16(14, stamp.date, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, content.byteLength, true);
    centralView.setUint32(24, content.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, localOffset, true);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.byteLength + content.byteLength;
  }

  const centralDirectory = joinBytes(centralParts);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirectory.byteLength, true);
  endView.setUint32(16, localOffset, true);
  endView.setUint16(20, 0, true);

  return joinBytes([...localParts, centralDirectory, end]);
}
