import { memo } from 'react';
import { boxStyle, elementText, imageStyle, lineStyle, shapeStyle, textStyle } from '../../lib/contract/model.js';

// Conteúdo de um elemento. Usado no editor, na medição e na impressão: o que se vê é o que sai no PDF.
export function ElementContent({ el, today }) {
  if (el.t === 'image') return <img src={el.src} alt="" draggable={false} style={imageStyle(el)} />;
  if (el.t === 'line') return <div style={lineStyle(el)} />;
  if (el.t === 'shape') return <div style={shapeStyle(el)} />;
  const text = elementText(el, today);
  // O espaço invisível mantém a altura de linhas vazias e de quebra de linha no final.
  return <div style={textStyle(el)}>{text.endsWith('\n') || text === '' ? `${text}\u200b` : text}</div>;
}

// Elemento posicionado na página (sem interação: a impressão usa este).
export const StaticElement = memo(function StaticElement({ el, today }) {
  return (
    <div style={boxStyle(el)}>
      <ElementContent el={el} today={today} />
    </div>
  );
});
