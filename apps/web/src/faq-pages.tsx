import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CircleHelp, Eye, EyeOff, FileText, Plus, Search, Star, Trash2 } from "lucide-react";
import { api, jsonBody } from "./api";
import { EmptyState, GlassButton, GlassCard, GlassInput } from "./components";

type FaqItem = { id: string; question: string; answer: string; category: string; isFeatured: boolean; isPublished: boolean; sortOrder: number; archivedAt: string | null; updatedAt: string };
type FaqDraft = Omit<FaqItem, "id" | "archivedAt" | "updatedAt">;
const blankDraft: FaqDraft = { question: "", answer: "", category: "Общее", isFeatured: false, isPublished: false, sortOrder: 0 };

export function FaqPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const params = new URLSearchParams();
  if (search.trim()) params.set("q", search.trim());
  if (category) params.set("category", category);
  const query = useQuery({ queryKey: ["faq", search, category], queryFn: () => api<{ items: FaqItem[]; categories: string[] }>(`/faq${params.size ? `?${params.toString()}` : ""}`) });
  return <div className="content-stack faq-page">
    <div className="page-heading"><div><span className="eyebrow">ПОМОЩЬ ПО ПРОЕКТУ</span><h1>Вопросы и ответы</h1><p>Короткие ответы на опубликованные вопросы о Вайбе.</p></div><CircleHelp size={25} /></div>
    <GlassCard className="faq-search-card"><label className="faq-search"><Search size={18} /><input aria-label="Найти вопрос или ответ" placeholder="Найти вопрос или ответ" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <div className="faq-category-filter"><button type="button" className={!category ? "is-active" : ""} onClick={() => setCategory("")}>Все темы</button>{query.data?.categories.map((item) => <button type="button" key={item} className={category === item ? "is-active" : ""} onClick={() => setCategory(item)}>{item}</button>)}</div>
    </GlassCard>
    {query.isLoading ? <GlassCard className="faq-loading">Загружаем ответы…</GlassCard> : query.isError ? <GlassCard className="faq-loading" role="alert">Не удалось загрузить FAQ. Обновите страницу и попробуйте ещё раз.</GlassCard> : query.data?.items.length ? <div className="faq-list">{query.data.items.map((item) => <details className="faq-item" key={item.id}><summary><span className="faq-question-icon"><CircleHelp size={17} /></span><span><strong>{item.question}</strong><small>{item.category}{item.isFeatured ? " · Важный ответ" : ""}</small></span><span className="faq-chevron" aria-hidden="true">+</span></summary><div className="faq-answer">{item.answer}</div></details>)}</div> : <EmptyState title="Ответов пока нет" detail={search || category ? "По выбранному запросу опубликованных ответов не найдено." : "Владелец проекта добавит проверенные ответы в этом разделе."} />}
  </div>;
}

export function OwnerFaqPage({ onMessage }: { onMessage: (message: string) => void }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<FaqDraft>(blankDraft);
  const [editing, setEditing] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const query = useQuery({ queryKey: ["owner-faq"], queryFn: () => api<FaqItem[]>("/owner/faq") });
  const invalidate = () => { void client.invalidateQueries({ queryKey: ["owner-faq"] }); void client.invalidateQueries({ queryKey: ["faq"] }); };
  const save = useMutation({ mutationFn: () => editing ? api(`/owner/faq/${editing}`, { method: "PUT", body: jsonBody(draft) }) : api("/owner/faq", { method: "POST", body: jsonBody(draft) }), onSuccess: () => { setDraft(blankDraft); setEditing(null); onMessage("Ответ сохранён"); invalidate(); }, onError: (error: Error) => onMessage(error.message) });
  const update = useMutation({ mutationFn: ({ id, values }: { id: string; values: Partial<FaqDraft> }) => api(`/owner/faq/${id}`, { method: "PATCH", body: jsonBody(values) }), onSuccess: invalidate, onError: (error: Error) => onMessage(error.message) });
  const archive = useMutation({ mutationFn: ({ id, restore }: { id: string; restore: boolean }) => api(`/owner/faq/${id}/${restore ? "restore" : "archive"}`, { method: "POST" }), onSuccess: () => { onMessage("Статус ответа обновлён"); invalidate(); }, onError: (error: Error) => onMessage(error.message) });
  const reorder = useMutation({ mutationFn: (ids: string[]) => api("/owner/faq-order", { method: "PUT", body: jsonBody({ ids }) }), onSuccess: invalidate, onError: (error: Error) => onMessage(error.message) });
  const activeItems = useMemo(() => (query.data ?? []).filter((item) => !item.archivedAt), [query.data]);
  const shown = (query.data ?? []).filter((item) => showArchived || !item.archivedAt);
  const edit = (item: FaqItem) => { setEditing(item.id); setDraft({ question: item.question, answer: item.answer, category: item.category, isFeatured: item.isFeatured, isPublished: item.isPublished, sortOrder: item.sortOrder }); document.querySelector(".faq-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const move = (id: string, direction: -1 | 1) => { const ids = activeItems.map((item) => item.id); const index = ids.indexOf(id); const next = index + direction; if (index < 0 || next < 0 || next >= ids.length) return; [ids[index], ids[next]] = [ids[next]!, ids[index]!]; reorder.mutate(ids); };
  return <div className="content-stack owner-faq-page">
    <div className="page-heading"><div><span className="eyebrow">УПРАВЛЕНИЕ СОДЕРЖИМЫМ</span><h1>Вопросы и ответы</h1><p>Публикуйте проверенные объяснения. Черновики видны только владельцу.</p></div></div>
    <div className="faq-owner-layout">
      <GlassCard className="faq-editor"><div className="section-card-heading"><div><span className="overline">РЕДАКТОР</span><h2>{editing ? "Изменить ответ" : "Новый ответ"}</h2></div><FileText size={18} /></div>
        <form onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
          <GlassInput label="Вопрос" required maxLength={240} value={draft.question} onChange={(event) => setDraft({ ...draft, question: event.target.value })} />
          <label className="field"><span>Ответ</span><textarea required maxLength={12_000} rows={7} value={draft.answer} onChange={(event) => setDraft({ ...draft, answer: event.target.value })} placeholder="Введите подтверждённый ответ. Он будет показан как обычный текст." /></label>
          <GlassInput label="Категория" required maxLength={80} value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} />
          <label className="field"><span>Порядок показа</span><input type="number" min={-100_000} max={100_000} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) || 0 })} /></label>
          <label className="faq-check"><input type="checkbox" checked={draft.isFeatured} onChange={(event) => setDraft({ ...draft, isFeatured: event.target.checked })} /><span><strong>Важный ответ</strong><small>Показывать выше остальных вопросов.</small></span></label>
          <label className="faq-check"><input type="checkbox" checked={draft.isPublished} onChange={(event) => setDraft({ ...draft, isPublished: event.target.checked })} /><span><strong>Опубликован</strong><small>Публикация откроет ответ на публичной странице.</small></span></label>
          {draft.question.trim() && <div className="faq-preview"><span className="overline">ПРЕДПРОСМОТР</span><strong>{draft.question}</strong><p>{draft.answer || "Ответ появится здесь после ввода."}</p></div>}
          <div className="owner-form-actions"><GlassButton type="submit" disabled={save.isPending || draft.question.trim().length < 5 || draft.answer.trim().length < 2}>{save.isPending ? "Сохраняем…" : editing ? "Сохранить изменения" : <><Plus size={16} /> Создать ответ</>}</GlassButton>{editing && <GlassButton type="button" variant="secondary" onClick={() => { setEditing(null); setDraft(blankDraft); }}>Отмена</GlassButton>}</div>
        </form>
      </GlassCard>
      <GlassCard className="faq-owner-list"><div className="section-card-heading"><div><span className="overline">БАЗА ОТВЕТОВ</span><h2>Сохранённые вопросы</h2></div><button type="button" className="text-button" onClick={() => setShowArchived((value) => !value)}>{showArchived ? "Скрыть архив" : "Показать архив"}</button></div>
        {query.isLoading ? <p>Загружаем список…</p> : query.isError ? <p role="alert">Список ответов не загрузился. Обновите страницу.</p> : !shown.length ? <EmptyState title="Вопросов пока нет" detail="Добавьте первый ответ в редакторе. Публичный FAQ не будет заполняться выдуманными фактами." /> : <div className="faq-owner-items">{shown.map((item) => <article className={`faq-owner-item ${item.archivedAt ? "is-archived" : ""}`} key={item.id}><div className="faq-owner-item-heading"><span className="faq-owner-icon">{item.isFeatured ? <Star size={17} /> : <CircleHelp size={17} />}</span><div><strong>{item.question}</strong><small>{item.category} · {item.archivedAt ? "Архив" : item.isPublished ? "Опубликован" : "Черновик"}</small></div></div><p>{item.answer}</p><div className="faq-owner-actions">{!item.archivedAt && <><GlassButton variant="secondary" onClick={() => edit(item)}>Изменить</GlassButton><GlassButton variant="secondary" disabled={reorder.isPending} aria-label="Переместить выше" onClick={() => move(item.id, -1)}><ArrowUp size={16} /></GlassButton><GlassButton variant="secondary" disabled={reorder.isPending} aria-label="Переместить ниже" onClick={() => move(item.id, 1)}><ArrowDown size={16} /></GlassButton><GlassButton variant="secondary" onClick={() => update.mutate({ id: item.id, values: { isPublished: !item.isPublished } })}>{item.isPublished ? <><EyeOff size={15} /> Снять</> : <><Eye size={15} /> Опубликовать</>}</GlassButton></>}{<GlassButton variant="secondary" onClick={() => archive.mutate({ id: item.id, restore: Boolean(item.archivedAt) })}>{item.archivedAt ? "Восстановить" : <><Trash2 size={15} /> В архив</>}</GlassButton>}</div></article>)}</div>}
      </GlassCard>
    </div>
  </div>;
}
