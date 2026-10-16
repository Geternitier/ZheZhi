export function randomSeed(): number {
  const buf = new Uint32Array(2);
  crypto.getRandomValues(buf);
  const seed = buf[0] * 2 ** 20 + (buf[1] % 2 ** 20);
  return seed || 1;
}
