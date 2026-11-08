import { useCallback, useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

function PdfPage({ pdf, number, width, zoom, onError }: { pdf: PDFDocumentProxy; number: number; width: number; zoom: number; onError: () => void }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [aspect, setAspect] = useState(1.414);

  useEffect(() => {
    let active = true;
    void pdf.getPage(number).then((page) => {
      if (!active) return;
      const viewport = page.getViewport({ scale: 1 });
      setAspect(viewport.height / viewport.width);
    }).catch(() => { if (active) onError(); });
    return () => { active = false; };
  }, [pdf, number, onError]);

  useEffect(() => {
    const element = wrapperRef.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { rootMargin: "1000px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let cancelRender: (() => void) | undefined;
    void pdf.getPage(number).then((pdfPage) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      const base = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: width * zoom / base.width });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = viewport.width + "px";
      canvas.style.height = viewport.height + "px";
      const render = pdfPage.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      cancelRender = () => render.cancel();
      return render.promise;
    }).catch(() => { if (!cancelled) onError(); });
    return () => { cancelled = true; cancelRender?.(); };
  }, [pdf, number, width, zoom, visible, onError]);

  return <div ref={wrapperRef} aria-label={"Страница " + number} style={{ width: width * zoom, minHeight: width * zoom * aspect, margin: "0 auto 12px", background: "white", boxShadow: "0 2px 8px #0002" }}>
    {visible && <canvas ref={canvasRef} aria-label={"Страница " + number} style={{ display: "block", background: "white", maxWidth: "none" }} />}
  </div>;
}

export function PdfViewer({ url }: { url: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [width, setWidth] = useState(300);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);
  const setErrorTrue = useCallback(() => setError(true), []);
  useEffect(() => {
    setError(false);
    const task = getDocument({ url, isEvalSupported: false });
    let active = true;
    task.promise.then((doc) => { if (active) setPdf(doc); }).catch(() => { if (active) setError(true); });
    return () => { active = false; setPdf(null); void task.destroy(); };
  }, [url]);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      const availableWidth = Math.max(200, (rect?.width ?? 320) - 24);
      const fitPageWidth = Math.max(200, ((rect?.height ?? 760) - 80) / 1.414);
      setWidth(availableWidth >= 768 ? Math.min(availableWidth, fitPageWidth) : availableWidth);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={containerRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#e9e9ed" }}>
    <nav aria-label="Управление документом" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, padding: 8, background: "white" }}>
      <span>{pdf ? "Страниц: " + pdf.numPages : "Загружаем документ…"}</span>
      <button type="button" aria-label="Уменьшить" onClick={() => setZoom((n) => Math.max(1, n - 0.25))}>−</button>
      <button type="button" aria-label="Увеличить" onClick={() => setZoom((n) => Math.min(3, n + 0.25))}>+</button>
    </nav>
    <div aria-label="Страницы документа" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 8 }}>
      {error ? <p role="alert">Не удалось показать документ. <a href={url} target="_blank" rel="noreferrer">Открыть отдельно</a> или <a href={url + "?download=1"}>скачать</a>.</p> : pdf && Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index + 1} pdf={pdf} number={index + 1} width={width} zoom={zoom} onError={setErrorTrue} />)}
    </div>
  </div>;
}
