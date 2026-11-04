import { useMemo } from 'react';
import { encodeBarcode } from '../lib/barcode.js';

export default function BarcodeSvg({ code, className, style }) {
  const bits = useMemo(() => encodeBarcode(code), [code]);
  if (!bits) return null;
  let path = '';
  for (let i = 0; i < bits.length;) {
    if (bits[i] !== '1') { i += 1; continue; }
    let end = i;
    while (bits[end] === '1') end += 1;
    path += `M${i} 0h${end - i}v1h-${end - i}z`;
    i = end;
  }
  return (
    <svg className={className} style={style} viewBox={`-10 0 ${bits.length + 20} 1`} preserveAspectRatio="none" shapeRendering="crispEdges" role="img" aria-label={`Código de barras ${code}`}>
      <path d={path} fill="#000" />
    </svg>
  );
}
