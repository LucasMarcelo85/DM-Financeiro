import { StaticElement } from '../../components/contract/ElementView.jsx';
import { isoToday, pageSize } from './model.js';

// Imprime / salva em PDF: monta as páginas dentro do próprio site (só visíveis na impressão)
// e chama o diálogo de impressão do navegador ("Salvar como PDF").
export async function printContract(doc, name) {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { w, h } = pageSize(doc.orientation);
  const today = isoToday();

  const html = doc.pages
    .map((page) =>
      renderToStaticMarkup(
        <div className="dmp-page" style={{ background: page.bg }}>
          {page.els.map((el) => <StaticElement key={el.id} el={el} today={today} />)}
        </div>
      )
    )
    .join('');

  document.getElementById('dm-print-root')?.remove();
  document.getElementById('dm-print-style')?.remove();

  const style = document.createElement('style');
  style.id = 'dm-print-style';
  // A página fica 1px menor que o A4 para o navegador não criar uma folha em branco a mais.
  style.textContent = `
    #dm-print-root { display: none; }
    @page { size: A4 ${doc.orientation === 'landscape' ? 'landscape' : 'portrait'}; margin: 0; }
    @media print {
      html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
      body > *:not(#dm-print-root) { display: none !important; }
      #dm-print-root { display: block !important; }
      #dm-print-root, #dm-print-root * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
      .dmp-page { position: relative; overflow: hidden; width: ${w}px; height: ${h - 1}px; break-after: page; page-break-after: always; }
      .dmp-page:last-child { break-after: auto; page-break-after: auto; }
    }`;
  const root = document.createElement('div');
  root.id = 'dm-print-root';
  root.innerHTML = html;
  document.head.appendChild(style);
  document.body.appendChild(root);

  const prevTitle = document.title;
  document.title = name || 'Contrato';
  if (document.fonts?.ready) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);

  const cleanup = () => {
    root.remove();
    style.remove();
    document.title = prevTitle;
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 5 * 60 * 1000); // garantia caso o navegador não avise o fim da impressão
  window.print();
}

// Baixa o modelo como arquivo .json (para guardar ou importar em outra conta).
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
