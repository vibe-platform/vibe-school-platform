import { useEffect, useRef, useState } from "react";
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfViewer({ url }: { url: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(300);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);

  useEffect(() => {
    setError(false);
    setPage(1);
    const task = getDocument({ url });
    let active = true;
    task.promise.then((doc) => { if (active) setPdf(doc); }).catch(() => { if (active) setError(true); });
    return () => { active = false; setPdf(null); void task.destroy(); };
  }, [url]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.max(200, (entries[0]?.contentRect.width ?? 320) - 24)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf) return;
    let cancelled = false;
    let cancelRender: (() => void) | undefined;
    void pdf.getPage(page).then((pdfPage) => {
      if (cancelled || !canvasRef.current) return;
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = width / base.width * zoom;
      const viewport = pdfPage.getViewport({ scale });
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = viewport.width + "px";
      canvas.style.height = viewport.height + "px";
      const render = pdfPage.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
      cancelRender = () => render.cancel();
      return render.promise;
    }).catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; cancelRender?.(); };
  }, [pdf, page, width, zoom]);

  return <div ref={containerRef} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "#e9e9ed" }}>
    <nav aria-label="Управление документом" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8, padding: 8, background: "white" }}>
      <button type="button" onClick={() => setPage((n) => Math.max(1, n - 1))} disabled={!pdf || page <= 1}>Назад</button>
      <span>Страница {page} из {pdf?.numPages ?? "…"}</span>
      <button type="button" onClick={() => setPage((n) => Math.min(pdf?.numPages ?? n, n + 1))} disabled={!pdf || page >= pdf.numPages}>Вперёд</button>
      <button type="button" aria-label="Уменьшить" onClick={() => setZoom((n) => Math.max(1, n - 0.25))}>−</button>
      <button type="button" aria-label="Увеличить" onClick={() => setZoom((n) => Math.min(3, n + 0.25))}>+</button>
    </nav>
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", textAlign: "center", padding: 8 }}>
      {error ? <p role="alert">Не удалось показать документ. <a href={url} target="_blank" rel="noreferrer">Открыть отдельно</a> или <a href={url + "?download=1"}>скачать</a>.</p> : <><canvas ref={canvasRef} aria-label={"Страница " + page} style={{ background: "white", maxWidth: "none" }} />{!pdf && <p>Загружаем документ…</p>}</>}
    </div>
  </div>;
}
