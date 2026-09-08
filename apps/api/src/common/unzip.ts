import { inflateRawSync } from 'node:zlib';

// Lector minimo de ZIP en memoria, sin dependencia externa. Cubre lo que
// publica la DNIT (un .txt por archivo, deflate o stored, < 4 GB). Lee el
// directorio central, que es la fuente fiable de tamaños y offsets: el
// header local puede traerlos en cero (bit 3 de los flags).

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

export interface ZipEntry {
  name: string;
  data: Buffer;
}

export function unzipEntries(buf: Buffer): ZipEntry[] {
  // El EOCD esta al final; el comentario del zip puede correrlo hasta 64 KB.
  const min = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('zip_invalido: no se encontro el directorio central');
  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || p === 0xffffffff) throw new Error('zip_invalido: formato zip64 no soportado');

  const out: ZipEntry[] = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('zip_invalido: entrada del directorio central corrupta');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue; // directorio
    if (buf.readUInt32LE(localOff) !== SIG_LOCAL) throw new Error(`zip_invalido: header local de ${name}`);
    const start = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const raw = buf.subarray(start, start + csize);
    let data: Buffer;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = inflateRawSync(raw);
    else throw new Error(`zip_invalido: metodo de compresion ${method} no soportado (${name})`);
    if (data.length !== usize) throw new Error(`zip_invalido: tamaño de ${name} no coincide`);
    out.push({ name, data });
  }
  return out;
}
