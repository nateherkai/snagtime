export function foregroundForBackground(value?: string | null) {
  const match = value?.match(/^#([0-9a-f]{6})$/i);
  if (!match) return "#ffffff";
  const hex = match[1]!;
  const channel = (offset: number) => { const raw = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255; return raw <= 0.04045 ? raw / 12.92 : ((raw + 0.055) / 1.055) ** 2.4; };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const inkContrast = (luminance + 0.05) / 0.058;
  return whiteContrast >= inkContrast ? "#ffffff" : "#101828";
}
