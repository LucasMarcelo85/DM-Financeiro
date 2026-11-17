import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const ImageLightboxContext = createContext(null);

export function useImageLightbox() {
  return useContext(ImageLightboxContext);
}

export default function ImageLightboxProvider({ children }) {
  const [image, setImage] = useState(null);
  const openImage = useCallback((src, alt = '', href = '') => {
    if (src) setImage({ src, alt, href });
  }, []);
  const closeImage = useCallback(() => setImage(null), []);
  const contextValue = useMemo(() => ({ openImage }), [openImage]);

  useEffect(() => {
    if (!image) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeImage();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [image, closeImage]);

  return (
    <ImageLightboxContext.Provider value={contextValue}>
      {children}
      {image && createPortal(
        <div className="pv-image-lightbox" role="dialog" aria-modal="true" aria-label="Imagem ampliada"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closeImage(); }}>
          <button type="button" className="pv-image-lightbox-close" onClick={closeImage} aria-label="Fechar imagem">×</button>
          <img src={image.src} alt={image.alt} />
          <div className="pv-image-lightbox-actions">
            <a className="pv-image-lightbox-download" href={image.src} download={downloadName(image.src, image.alt)}>
              Baixar imagem
            </a>
            {image.href && <a className="pv-image-lightbox-link" href={image.href} target="_blank" rel="noopener noreferrer">Abrir link</a>}
          </div>
        </div>,
        document.body,
      )}
    </ImageLightboxContext.Provider>
  );
}

function downloadName(src, alt) {
  const name = String(alt || 'imagem-do-portfolio')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const dataMime = /^data:image\/(png|jpeg|webp);/i.exec(src || '')?.[1];
  const pathExtension = /\.(png|jpe?g|webp)(?:[?#]|$)/i.exec(src || '')?.[1]?.toLowerCase();
  const extension = dataMime === 'jpeg' ? 'jpg' : dataMime || (pathExtension === 'jpeg' ? 'jpg' : pathExtension) || 'jpg';
  return `${name || 'imagem-do-portfolio'}.${extension}`;
}
