import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowLeft, ArrowRight, Building2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Eye, ImagePlus, MapPin, Plus, Save, Trash2, X, ZoomIn, ZoomOut } from "lucide-react";
import { api, jsonBody } from "./api";
import { GlassButton, GlassCard, GlassInput, GlassModal } from "./components";

type ToastHook = { message: string; show: (message: string) => void; close: () => void };
type MediaType = "MEETING" | "CONTRACT" | "LOCATION" | "LOGO" | "COVER";
type PartnerMedia = { id?: string; imageAttachmentId: string; type: MediaType; caption: string; sortOrder?: number; imageUrl: string };
type Partner = { id: string; name: string; category: string | null; city: string | null; shortDescription: string; mapUrl: string | null; isPublished: boolean; sortOrder: number; archivedAt: string | null; updatedAt: string; media: PartnerMedia[] };
type PartnerDraft = Omit<Partner, "id" | "archivedAt" | "updatedAt">;
const emptyDraft = (): PartnerDraft => ({ name: "", category: "", city: "", shortDescription: "", mapUrl: "", isPublished: false, sortOrder: 0, media: [] });
const tabs: Array<{ id: MediaType; label: string }> = [{ id: "CONTRACT", label: "Договор" }, { id: "LOCATION", label: "Расположение" }];

export function PartnersPage({ toast }: { toast: ToastHook }) {
  const query = useQuery({ queryKey: ["partners"], queryFn: () => api<Partner[]>("/partners") });
  const [selected, setSelected] = useState(0);
  const [scrollRef, setScrollRef] = useState<HTMLDivElement | null>(null);
  const [viewer, setViewer] = useState<{ images: PartnerMedia[]; index: number } | null>(null);
  const partners = query.data ?? [];
  const partner = partners[Math.min(selected, Math.max(0, partners.length - 1))];
  useEffect(() => { if (selected >= partners.length) setSelected(Math.max(0, partners.length - 1)); }, [partners.length, selected]);
  const moveCarousel = (direction: number) => scrollRef?.scrollBy({ left: direction * Math.max(220, scrollRef.clientWidth * 0.72), behavior: "smooth" });
  return <div className="content-stack cooperation-page">
    <div className="cooperation-heading"><div><span className="eyebrow">ПРОЕКТ «ВАЙБ»</span><h1>Сотрудничество</h1><p>Места и организации, которые поддерживают школьные инициативы.</p></div><span className="cooperation-heading-mark"><Building2 size={24} /></span></div>
    {query.isLoading ? <GlassCard className="cooperation-empty"><span className="cooperation-loader" />Загружаем список организаций…</GlassCard> : query.isError ? <GlassCard className="cooperation-empty"><strong>Не удалось загрузить список</strong><p>{(query.error as Error).message}</p><GlassButton variant="secondary" onClick={() => void query.refetch()}>Повторить</GlassButton></GlassCard> : !partners.length ? <GlassCard className="cooperation-empty"><span className="cooperation-empty-icon"><Building2 size={28} /></span><h2>Точки сотрудничества скоро появятся</h2><p>Здесь будут организации, поддерживающие школьные и молодёжные инициативы.</p></GlassCard> : <>
      <section className="partner-carousel-shell" aria-label="Партнёры проекта">
        <div className="partner-carousel-heading"><div><span className="overline">НАШИ ОРГАНИЗАЦИИ</span><h2>Точки сотрудничества</h2></div><div className="partner-carousel-controls"><button className="icon-button" type="button" aria-label="Предыдущие организации" onClick={() => moveCarousel(-1)}><ChevronLeft size={20} /></button><button className="icon-button" type="button" aria-label="Следующие организации" onClick={() => moveCarousel(1)}><ChevronRight size={20} /></button></div></div>
        <div className="partner-carousel" ref={setScrollRef} tabIndex={0} onScroll={() => { if (!scrollRef) return; const box = scrollRef.getBoundingClientRect(); const children = Array.from(scrollRef.children); const nearest = children.reduce((best, child, index) => Math.abs(child.getBoundingClientRect().left - box.left) < Math.abs(children[best]!.getBoundingClientRect().left - box.left) ? index : best, 0); if (nearest !== selected) setSelected(nearest); }} onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const next = Math.max(0, Math.min(partners.length - 1, selected + (event.key === "ArrowLeft" ? -1 : 1))); setSelected(next); scrollRef?.children[next]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" }); }}>
          {partners.map((item, index) => <button key={item.id} type="button" className={`partner-carousel-card ${selected === index ? "is-selected" : ""}`} aria-pressed={selected === index} onClick={() => setSelected(index)}>
            <span className="partner-carousel-art">{item.media.find((image) => image.type === "LOGO")?.imageUrl ? <img src={item.media.find((image) => image.type === "LOGO")!.imageUrl} alt="" /> : <Building2 size={24} />}</span><span className="partner-carousel-copy"><strong>{item.name}</strong><small>{[item.category, item.city].filter(Boolean).join(" · ") || "Организация"}</small></span>
          </button>)}
        </div>
        <div className="partner-carousel-count" aria-live="polite">{selected + 1} / {partners.length}</div>
      </section>
      {partner && <PartnerDetail partner={partner} onOpen={(images, index) => setViewer({ images, index })} />}
      {viewer && <FullscreenImageViewer images={viewer.images} index={viewer.index} onChange={(index) => setViewer((value) => value ? { ...value, index } : null)} onClose={() => setViewer(null)} />}
    </>}
    <ToastNotice toast={toast} />
  </div>;
}

function PartnerDetail({ partner, onOpen }: { partner: Partner; onOpen: (images: PartnerMedia[], index: number) => void }) {
  const [activeTab, setActiveTab] = useState<MediaType>("CONTRACT");
  const current = partner.media.filter((item) => item.type === activeTab);
  const cover = partner.media.find((item) => item.type === "COVER");
  const place = partner.media.filter((item) => item.type === "LOCATION");
  const images = activeTab === "LOCATION" ? place : current;
  return <section className="partner-detail" aria-label={`Информация об организации ${partner.name}`}>
    {cover && <button className="partner-cover" type="button" onClick={() => onOpen([cover], 0)}><img src={cover.imageUrl} alt={cover.caption || `Обложка: ${partner.name}`} /><span>Открыть фотографию</span></button>}
    <GlassCard className="partner-intro"><div className="partner-intro-copy"><span className="overline">{[partner.category, partner.city].filter(Boolean).join(" · ") || "ТОЧКА СОТРУДНИЧЕСТВА"}</span><h2>{partner.name}</h2><p>{partner.shortDescription}</p>{partner.mapUrl && <a className="partner-map-link" href={partner.mapUrl} target="_blank" rel="noreferrer"><MapPin size={17} />Открыть в Яндекс Картах<ExternalLink size={15} /></a>}</div></GlassCard>
    <div className="partner-tabs" role="tablist" aria-label="Сведения об организации">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={activeTab === tab.id} className={activeTab === tab.id ? "is-active" : ""} onClick={() => setActiveTab(tab.id)}>{tab.label}<span>{partner.media.filter((item) => item.type === tab.id).length}</span></button>)}</div>
    {!images.length ? <GlassCard className="partner-gallery-empty"><ImagePlus size={22} /><span>Фотографии этого раздела пока не добавлены.</span></GlassCard> : <div className="partner-gallery">{images.map((image, index) => <button key={image.id ?? image.imageAttachmentId} type="button" className="partner-gallery-item" onClick={() => onOpen(images, index)}><img src={image.imageUrl} alt={image.caption || `${partner.name} — ${tabs.find((tab) => tab.id === activeTab)?.label ?? "фото"}`} loading="lazy" /><span>{image.caption || tabs.find((tab) => tab.id === activeTab)?.label}</span></button>)}</div>}
  </section>;
}

export function FullscreenImageViewer({ images, index, onChange, onClose }: { images: PartnerMedia[]; index: number; onChange: (index: number) => void; onClose: () => void }) {
  const [zoom, setZoom] = useState(1);
  const current = images[index];
  useEffect(() => { setZoom(1); }, [index]);
  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onChange(Math.max(0, index - 1));
      if (event.key === "ArrowRight") onChange(Math.min(images.length - 1, index + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = oldOverflow; window.removeEventListener("keydown", onKey); };
  }, [images.length, index, onChange, onClose]);
  if (!current) return null;
  return <div className="fullscreen-image-viewer" role="dialog" aria-modal="true" aria-label="Просмотр фотографии" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="viewer-toolbar"><span>{index + 1} / {images.length}</span><div><button type="button" aria-label="Уменьшить изображение" onClick={() => setZoom((value) => Math.max(1, value - 0.25))}><ZoomOut size={20} /></button><button type="button" aria-label="Увеличить изображение" onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))}><ZoomIn size={20} /></button><button type="button" aria-label="Закрыть просмотр" onClick={onClose}><X size={22} /></button></div></header>
    {index > 0 && <button className="viewer-arrow viewer-previous" type="button" aria-label="Предыдущее фото" onClick={() => onChange(index - 1)}><ChevronLeft size={30} /></button>}
    <div className="viewer-image-stage"><img src={current.imageUrl} alt={current.caption || "Фотография организации"} style={{ transform: `scale(${zoom})` }} draggable={false} /></div>
    {index < images.length - 1 && <button className="viewer-arrow viewer-next" type="button" aria-label="Следующее фото" onClick={() => onChange(index + 1)}><ChevronRight size={30} /></button>}
    <footer className="viewer-caption">{current.caption || ""}</footer>
  </div>;
}

export function OwnerLegalSettingsPage({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["owner-legal-settings"], queryFn: () => api<Record<string, any>>("/owner/legal-settings") });
  const [form, setForm] = useState<Record<string, any>>({ generalEmail: "vaibe32@mail.ru", privacyEmail: "vaibe32@mail.ru", domain: "vaibe32.ru" });
  useEffect(() => { if (query.data) setForm({ ...query.data, generalEmail: query.data.generalEmail ?? "vaibe32@mail.ru", privacyEmail: query.data.privacyEmail ?? "vaibe32@mail.ru", domain: query.data.domain ?? "vaibe32.ru" }); }, [query.data]);
  const save = useMutation({ mutationFn: () => {
    const fields = ["organizationFullName", "organizationShortName", "legalAddress", "location", "inn", "ogrn", "generalEmail", "privacyEmail", "domain", "hostingProvider", "serverLocation"];
    return api("/owner/legal-settings", { method: "PUT", body: jsonBody(Object.fromEntries(fields.map((key) => [key, form[key] ?? null]))) });
  }, onSuccess: () => { toast.show("Юридические сведения сохранены"); void client.invalidateQueries({ queryKey: ["owner-legal-settings"] }); void client.invalidateQueries({ queryKey: ["public-legal-settings"] }); }, onError: (error: Error) => toast.show(error.message) });
  if (query.isLoading) return <GlassCard>Загружаем юридические сведения…</GlassCard>;
  if (query.isError) return <GlassCard><strong>Не удалось загрузить сведения</strong><p>{(query.error as Error).message}</p><GlassButton variant="secondary" onClick={() => void query.refetch()}>Повторить</GlassButton></GlassCard>;
  const textFields: Array<[string, string, string, number]> = [
    ["organizationFullName", "Полное наименование организации или ФИО владельца", "Как указано в регистрационных документах", 240],
    ["organizationShortName", "Краткое наименование", "", 120],
    ["legalAddress", "Адрес владельца", "Полный адрес", 500],
    ["location", "Место нахождения", "", 240],
    ["inn", "ИНН", "", 20],
    ["ogrn", "ОГРН или ОГРНИП", "", 20],
    ["generalEmail", "Email для общих обращений", "vaibe32@mail.ru", 254],
    ["privacyEmail", "Email по вопросам персональных данных", "vaibe32@mail.ru", 254],
    ["domain", "Домен сайта", "vaibe32.ru", 253],
    ["hostingProvider", "Провайдер размещения", "", 240],
    ["serverLocation", "Страна и место размещения данных", "Уточните у провайдера размещения", 500],
  ];
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <div className="content-stack owner-legal-page"><div className="cooperation-heading"><div><span className="eyebrow">ДЛЯ ВЛАДЕЛЬЦА</span><h1>Юридическая информация</h1><p>Укажите проверенные реквизиты и контакты владельца сервиса.</p></div></div>
    <GlassCard className="legal-owner-form"><div className="section-card-heading"><div><span className="overline">ВЛАДЕЛЕЦ И КОНТАКТЫ</span><h2>Реквизиты и размещение</h2></div></div><div className="owner-legal-fields">{textFields.map(([key, label, placeholder, maxLength]) => <GlassInput key={key} label={label} type={key.toLowerCase().includes("email") ? "email" : "text"} value={form[key] ?? ""} placeholder={placeholder} maxLength={maxLength} onChange={(event) => update(key, event.target.value)} />)}</div>
      <div className="owner-form-actions"><GlassButton onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Сохраняем…" : "Сохранить сведения"}<Save size={16} /></GlassButton></div>
    </GlassCard>
  </div>;
}
export function OwnerPartnersPage({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["owner-partners"], queryFn: () => api<Partner[]>("/owner/partners") });
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<PartnerDraft>(emptyDraft());
  const [newImages, setNewImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [archive, setArchive] = useState<Partner | null>(null);
  const [viewer, setViewer] = useState<{ images: PartnerMedia[]; index: number } | null>(null);
  const save = useMutation({ mutationFn: () => api<Partner>(editingId === "new" ? "/owner/partners" : `/owner/partners/${editingId}`, { method: editingId === "new" ? "POST" : "PATCH", body: jsonBody({ name: draft.name, category: draft.category || null, city: draft.city || null, shortDescription: draft.shortDescription, mapUrl: draft.mapUrl || null, isPublished: draft.isPublished, sortOrder: draft.sortOrder, media: draft.media.map(({ imageAttachmentId, type, caption }) => ({ imageAttachmentId, type, caption })) }) }), onSuccess: (partner) => { const retained = new Set(partner.media.map((image) => image.imageAttachmentId)); for (const id of newImages) if (!retained.has(id)) void api(`/owner/about/images/${id}`, { method: "DELETE" }).catch(() => undefined); setEditingId(null); setNewImages([]); setPreview(false); toast.show("Точка сотрудничества сохранена"); void client.invalidateQueries({ queryKey: ["owner-partners"] }); void client.invalidateQueries({ queryKey: ["partners"] }); }, onError: (error: Error) => toast.show(error.message) });
  const discard = () => { for (const id of newImages) void api(`/owner/about/images/${id}`, { method: "DELETE" }).catch(() => undefined); setNewImages([]); setEditingId(null); setPreview(false); };
  const beginEdit = (partner?: Partner) => { setNewImages([]); setPreview(false); setDraft(partner ? { name: partner.name, category: partner.category ?? "", city: partner.city ?? "", shortDescription: partner.shortDescription, mapUrl: partner.mapUrl ?? "", isPublished: partner.isPublished, sortOrder: partner.sortOrder, media: partner.media.map((item) => ({ ...item })) } : { ...emptyDraft(), sortOrder: query.data?.length ?? 0 }); setEditingId(partner?.id ?? "new"); };
  const upload = async (type: MediaType, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files).slice(0, type === "LOGO" || type === "COVER" ? 1 : 10)) {
        const form = new FormData(); form.append("image", file);
        const image = await api<{ id: string; url: string }>("/owner/about/images", { method: "POST", body: form });
        setNewImages((current) => [...current, image.id]);
        setDraft((current) => ({ ...current, media: type === "LOGO" || type === "COVER" ? [...current.media.filter((item) => item.type !== type), { imageAttachmentId: image.id, imageUrl: image.url, type, caption: "" }] : [...current.media, { imageAttachmentId: image.id, imageUrl: image.url, type, caption: "" }] }));
      }
      toast.show("Фото загружено в проект. Сохраните карточку, чтобы закрепить его.");
    } catch (error) { toast.show((error as Error).message); }
    finally { setUploading(false); }
  };
  const replacePhoto = async (imageId: string, file: File) => {
    setUploading(true);
    try {
      const form = new FormData(); form.append("image", file);
      const image = await api<{ id: string; url: string }>("/owner/about/images", { method: "POST", body: form });
      setNewImages((current) => [...current, image.id]);
      setDraft((current) => ({ ...current, media: current.media.map((item) => item.imageAttachmentId === imageId ? { ...item, imageAttachmentId: image.id, imageUrl: image.url } : item) }));
      toast.show("Фото заменено. Сохраните изменения.");
    } catch (error) { toast.show((error as Error).message); }
    finally { setUploading(false); }
  };
  const setCaption = (id: string, caption: string) => setDraft((current) => ({ ...current, media: current.media.map((item) => item.imageAttachmentId === id ? { ...item, caption } : item) }));
  const removeMedia = (id: string) => setDraft((current) => ({ ...current, media: current.media.filter((item) => item.imageAttachmentId !== id) }));
  const moveMedia = (id: string, direction: number) => setDraft((current) => { const images = [...current.media]; const index = images.findIndex((item) => item.imageAttachmentId === id); const target = index + direction; if (index < 0 || target < 0 || target >= images.length) return current; [images[index], images[target]] = [images[target]!, images[index]!]; return { ...current, media: images }; });
  const archiveMutation = useMutation({ mutationFn: (partner: Partner) => api(`/owner/partners/${partner.id}/archive`, { method: "POST", body: jsonBody({}) }), onSuccess: () => { setArchive(null); toast.show("Точка убрана из публичной ленты и сохранена в архиве"); void client.invalidateQueries({ queryKey: ["owner-partners"] }); void client.invalidateQueries({ queryKey: ["partners"] }); }, onError: (error: Error) => toast.show(error.message) });
  const movePartner = async (partner: Partner, direction: "UP" | "DOWN") => {
    try { await api(`/owner/partners/${partner.id}/order`, { method: "POST", body: jsonBody({ direction }) }); void client.invalidateQueries({ queryKey: ["owner-partners"] }); void client.invalidateQueries({ queryKey: ["partners"] }); }
    catch (error) { toast.show((error as Error).message); }
  };
  const activeMedia = useMemo(() => draft.media, [draft.media]);
  if (query.isLoading) return <GlassCard>Загружаем точки сотрудничества…</GlassCard>;
  if (query.isError) return <GlassCard><strong>Список недоступен</strong><p>{(query.error as Error).message}</p><GlassButton variant="secondary" onClick={() => void query.refetch()}>Повторить</GlassButton></GlassCard>;
  return <div className="content-stack owner-partners-page"><div className="cooperation-heading"><div><span className="eyebrow">УПРАВЛЕНИЕ ПРОЕКТОМ</span><h1>Сотрудничество</h1><p>Редактируйте публикации организаций. Пока владелец не добавит реальные сведения, публичная лента остаётся пустой.</p></div><GlassButton onClick={() => beginEdit()}><Plus size={17} />Добавить точку</GlassButton></div>
    {!query.data!.length && editingId === null ? <GlassCard className="cooperation-empty"><span className="cooperation-empty-icon"><Building2 size={28} /></span><h2>Добавьте первую точку сотрудничества</h2><p>Здесь появится список организаций после сохранения.</p><GlassButton onClick={() => beginEdit()}><Plus size={16} />Добавить</GlassButton></GlassCard> : <div className="owner-partner-list">{query.data!.map((partner) => { const activePartners = query.data!.filter((item) => !item.archivedAt); const position = activePartners.findIndex((item) => item.id === partner.id); return <GlassCard key={partner.id} className="owner-partner-row"><div className="owner-partner-summary"><span className="partner-carousel-art">{partner.media.find((image) => image.type === "LOGO")?.imageUrl ? <img src={partner.media.find((image) => image.type === "LOGO")!.imageUrl} alt="" /> : <Building2 size={23} />}</span><div><strong>{partner.name}</strong><small>{[partner.category, partner.city].filter(Boolean).join(" · ") || "Без категории и города"} · {partner.media.length} фото · изменено {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(partner.updatedAt))}</small></div><span className={`partner-status ${partner.isPublished ? "published" : "draft"}`}>{partner.isPublished ? "Опубликовано" : "Черновик"}</span></div><div className="owner-partner-actions">{!partner.archivedAt && <div className="partner-order-controls"><button type="button" aria-label={`Переместить ${partner.name} выше`} disabled={position <= 0} onClick={() => void movePartner(partner, "UP")}><ChevronUp size={18} /></button><button type="button" aria-label={`Переместить ${partner.name} ниже`} disabled={position === activePartners.length - 1} onClick={() => void movePartner(partner, "DOWN")}><ChevronDown size={18} /></button></div>}<GlassButton variant="secondary" onClick={() => beginEdit(partner)} disabled={Boolean(partner.archivedAt)}>Редактировать</GlassButton><GlassButton variant="secondary" onClick={() => { beginEdit(partner); setPreview(true); }}><Eye size={16} />Предпросмотр</GlassButton>{!partner.archivedAt && <GlassButton variant="secondary" onClick={() => setArchive(partner)}><Archive size={16} />В архив</GlassButton>}</div></GlassCard>; })}</div>}
    {editingId !== null && <GlassCard className="cooperation-editor"><div className="section-card-heading"><div><span className="overline">{editingId === "new" ? "НОВАЯ ПУБЛИКАЦИЯ" : "ИЗМЕНЕНИЕ"}</span><h2>{editingId === "new" ? "Точка сотрудничества" : draft.name || "Точка сотрудничества"}</h2></div><button className="icon-button" aria-label="Закрыть редактор" onClick={discard}><X size={19} /></button></div>
      <div className="cooperation-form-grid"><GlassInput label="Название организации *" value={draft.name} maxLength={150} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} /><GlassInput label="Категория" value={draft.category ?? ""} maxLength={100} placeholder="Например, образование" onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value }))} /><GlassInput label="Город" value={draft.city ?? ""} maxLength={100} onChange={(event) => setDraft((value) => ({ ...value, city: event.target.value }))} /><label className="field cooperation-description"><span>Краткое описание</span><textarea value={draft.shortDescription} maxLength={1200} rows={4} onChange={(event) => setDraft((value) => ({ ...value, shortDescription: event.target.value }))} /></label><GlassInput label="Ссылка на место в Яндекс Картах" value={draft.mapUrl ?? ""} maxLength={1000} placeholder="https://yandex.ru/maps/..." onChange={(event) => setDraft((value) => ({ ...value, mapUrl: event.target.value }))} /></div>
      {([["LOGO", "Логотип"], ["COVER", "Обложка"], ...tabs.map((tab) => [tab.id, tab.label] as [MediaType, string])] as Array<[MediaType, string]>).map(([type, label]) => <section className="cooperation-media-section" key={type}><div><h3>{label}</h3>{type !== "LOGO" && type !== "COVER" && <p>Можно добавить несколько фотографий; подписи и порядок сохраняются.</p>}</div><label className="upload-drop cooperation-upload"><input type="file" accept="image/jpeg,image/png,image/webp" multiple={type !== "LOGO" && type !== "COVER"} disabled={uploading} onChange={(event) => { void upload(type, event.currentTarget.files); event.currentTarget.value = ""; }} /><ImagePlus size={19} /><span>{uploading ? "Загружаем…" : type === "LOGO" || type === "COVER" ? `Выбрать ${label.toLowerCase()}` : "Добавить фотографии"}</span></label>
        <div className="cooperation-media-list">{activeMedia.filter((item) => item.type === type).map((item, index) => <article className="cooperation-media-row" key={item.imageAttachmentId}><button type="button" className="cooperation-media-preview" onClick={() => setViewer({ images: activeMedia.filter((image) => image.type === type), index })}><img src={item.imageUrl} alt={item.caption || label} /></button><label className="field"><span>Короткая подпись</span><input maxLength={240} value={item.caption} onChange={(event) => setCaption(item.imageAttachmentId, event.target.value)} placeholder="Например, основное здание" /></label><div className="cooperation-media-actions"><label className="cooperation-replace-photo" title="Заменить фото"><ImagePlus size={17} /><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Заменить фото ${label.toLowerCase()} ${index + 1}`} disabled={uploading} onChange={(event) => { const file = event.currentTarget.files?.[0]; if (file) void replacePhoto(item.imageAttachmentId, file); event.currentTarget.value = ""; }} /></label><button type="button" aria-label="Переместить выше" disabled={index === 0} onClick={() => moveMedia(item.imageAttachmentId, -1)}><ArrowLeft size={17} /></button><button type="button" aria-label="Переместить ниже" disabled={index === activeMedia.filter((image) => image.type === type).length - 1} onClick={() => moveMedia(item.imageAttachmentId, 1)}><ArrowRight size={17} /></button><button type="button" aria-label="Удалить фото" onClick={() => removeMedia(item.imageAttachmentId)}><Trash2 size={17} /></button></div></article>)}</div>
      </section>)}
      <label className="legal-owner-checkbox"><input type="checkbox" checked={draft.isPublished} onChange={(event) => setDraft((value) => ({ ...value, isPublished: event.target.checked }))} /><span>Опубликовать в публичной ленте. Убедитесь, что фотографии и данные можно разместить.</span></label>
      <div className="owner-form-actions"><GlassButton variant="secondary" onClick={() => setPreview(true)} disabled={!draft.name.trim()}><Eye size={16} />Предпросмотр</GlassButton><GlassButton onClick={() => save.mutate()} disabled={!draft.name.trim() || save.isPending || uploading}>{save.isPending ? "Сохраняем…" : "Сохранить изменения"}<Save size={16} /></GlassButton><GlassButton variant="secondary" onClick={discard} disabled={save.isPending || uploading}>Отмена</GlassButton></div>
    </GlassCard>}
    {preview && <GlassModal open title="Предпросмотр публичной страницы" onClose={() => setPreview(false)}><PartnerDetail partner={{ id: "preview", ...draft, archivedAt: null, updatedAt: new Date().toISOString() }} onOpen={(images, index) => setViewer({ images, index })} /><div className="owner-form-actions"><GlassButton onClick={() => setPreview(false)}>Закрыть просмотр</GlassButton></div></GlassModal>}
    {viewer && <FullscreenImageViewer images={viewer.images} index={viewer.index} onChange={(index) => setViewer((value) => value ? { ...value, index } : null)} onClose={() => setViewer(null)} />}
    <GlassModal open={Boolean(archive)} title="Убрать точку из публикаций?" onClose={() => setArchive(null)}><p>«{archive?.name}» будет скрыта с сайта и перемещена в архив. Фотографии останутся в карточке.</p><div className="owner-form-actions"><GlassButton variant="secondary" onClick={() => setArchive(null)}>Отмена</GlassButton><GlassButton variant="danger" onClick={() => archive && archiveMutation.mutate(archive)} disabled={archiveMutation.isPending}>{archiveMutation.isPending ? "Убираем…" : "Убрать в архив"}<Archive size={16} /></GlassButton></div></GlassModal>
  </div>;
}

function ToastNotice({ toast }: { toast: ToastHook }) { return toast.message ? <div className="cooperation-toast" role="status"><span>{toast.message}</span><button type="button" aria-label="Закрыть уведомление" onClick={toast.close}><X size={16} /></button></div> : null; }
