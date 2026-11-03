import * as csstree from 'css-tree';

const FORBIDDEN_PROPERTIES = new Set(['behavior', '-moz-binding', 'binding']);

export function cleanGrapesCss(value) {
  const css = String(value || '');
  if (!css.trim()) return '';
  let ast;
  try {
    ast = csstree.parse(css, { parseValue: true, parseRulePrelude: true });
  } catch {
    throw new Error('O CSS contém uma regra inválida. Corrija o estilo antes de continuar.');
  }
  csstree.walk(ast, function cleanRule(node, item, list) {
    if (node.type === 'Atrule' && !['media', 'supports', 'keyframes', '-webkit-keyframes'].includes(node.name.toLowerCase())) {
      list.remove(item);
      return;
    }
    if (node.type !== 'Declaration') return;
    let unsafe = FORBIDDEN_PROPERTIES.has(node.property.toLowerCase());
    csstree.walk(node.value, (valueNode) => {
      if (valueNode.type === 'Url' || (valueNode.type === 'Function' && ['url', 'expression'].includes(valueNode.name.toLowerCase()))) unsafe = true;
    });
    if (unsafe || /javascript|vbscript|expression\s*\(/i.test(csstree.generate(node.value))) list.remove(item);
  });
  return csstree.generate(ast);
}
