import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Ban, Check, ChevronRight, Flame, LockKeyhole, X } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function GlassCard({ children, className = "", as: Component = "section", ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode; as?: "section" | "div" | "article" }) {
  return <Component className={`glass-card ${className}`} {...props}>{children}</Component>;
}

export function GlassButton({ children, variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "quiet" | "danger" }) {
  return <button className={`glass-button button-${variant} ${className}`} {...props}>{children}</button>;
}

export function GlassInput({ label, hint, className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return <label className={`field ${className}`}><span>{label}</span><input {...props} />{hint && <small>{hint}</small>}</label>;
}

export function GlassModal({ open, title, children, onClose }: { open: boolean; title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="glass-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Закрыть окно" onClick={onClose}><X size={20} /></button></header>{children}</section></div>, document.body);
}

export function GlassDrawer({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return <div className={`drawer-backdrop ${open ? "is-open" : ""}`} aria-hidden={!open} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="glass-drawer" aria-label="Главное меню">{children}</aside></div>;
}

const statusNames: Record<string, string> = {
  AVAILABLE: "Доступно", IN_PROGRESS: "В работе", SUBMITTED: "На проверке", RETURNED: "Нужна доработка", COMPLETED: "Завершено", EXPIRED: "Срок истёк", OVERDUE: "Просрочено", DRAFT: "Черновик", PUBLISHED: "Опубликовано", RESERVED: "Ожидает выдачи", FULFILLED: "Выдано", CANCELLED: "Отменён",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge status-${status.toLowerCase()}`}><i aria-hidden="true" />{statusNames[status] ?? status}</span>;
}

export function ExpBar({ totalExp, level, compact = false }: { totalExp: number; level: number; compact?: boolean }) {
  const lower = level * level - 1;
  const next = (level + 1) * (level + 1) - 1;
  const current = Math.max(0, totalExp - lower);
  const required = next - lower;
  const percent = Math.min(100, required ? Math.round(current / required * 100) : 100);
  return <div className={`exp-wrap ${compact ? "is-compact" : ""}`} aria-label={`Уровень ${level}, ${current} из ${required} опыта до следующего`}><div className="exp-meta"><strong>{compact ? `Уровень ${level}` : `Уровень ${level} · ${current}/${required} EXP`}</strong>{!compact && <span>ещё {Math.max(0, next - totalExp)} EXP</span>}</div><div className="exp-track"><span style={{ width: `${percent}%` }} /></div></div>;
}

export function BalanceBadge({ balance, size = "standard" }: { balance: number; size?: "standard" | "profile" }) {
  return <span className={`balance-badge ${size === "profile" ? "balance-badge-profile" : ""}`}><span className={`einstein-coin ${size === "profile" ? "einstein-coin-profile" : ""}`} aria-hidden="true"><img src="/brand/einstein-coin.png" alt="" /></span>{balance.toLocaleString("ru-RU")} <span className="balance-label">Эйнштейнов</span></span>;
}

export function StreakBadge({ current, best }: { current: number; best: number }) {
  return <span className="streak-badge"><Flame size={17} aria-hidden="true" /><strong>{current} дн.</strong><span>Личный ритм · рекорд {best}</span></span>;
}

export type UserView = { name: string; firstName: string; lastName: string; username?: string | null; avatarUrl?: string | null; level: number; totalExp: number; balance: number; role?: string | null; school?: { name?: string; city?: string } | null; class?: { name?: string } | null };
export type AppearanceView = { background: string; emoji: string; frame: string; title: string; pattern: string };

export function Avatar({ user, frame = "frame-none", size = "md" }: { user: UserView; frame?: string; size?: "sm" | "md" | "lg" }) {
  const avatarUrl = user.avatarUrl?.trim() || null;
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const testOrdinal = user.name.match(/^Пользователь ([1234])$/u)?.[1];
  const initials = testOrdinal ? `П${testOrdinal}` : `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toLocaleUpperCase("ru-RU") || "В";
  const showImage = Boolean(avatarUrl && failedAvatarUrl !== avatarUrl);
  return <span className={`avatar-wrap avatar-${size} ${frameClass(frame)}`} aria-label={`Аватар ${user.name}`}>{showImage ? <img src={avatarUrl!} alt="" referrerPolicy="no-referrer" onError={() => setFailedAvatarUrl(avatarUrl)} /> : <span>{initials}</span>}</span>;
}

export function cosmeticBackground(slug: string) {
  return `profile-surface surface-${slug.replace(/^bg-/u, "").replace(/^pearl$/u, "pearl")}`;
}

export function frameClass(slug: string) { return `cosmetic-frame cosmetic-${slug.replace(/^frame-/u, "")}`; }

export function ProfilePreview({ user, appearance, items = [], preview = false, compact = false }: { user: UserView; appearance: AppearanceView; items?: Array<{ slug: string; displayName: string; value: string }>; preview?: boolean; compact?: boolean }) {
    const emoji = items.find((item) => item.slug === appearance.emoji)?.value ?? "";
    const title = items.find((item) => item.slug === appearance.title)?.value ?? "";
    const frameItem = items.find((item) => item.slug === appearance.frame);
    const className = user.class?.name;
    const schoolName = user.school?.name;
  return <section className={`${cosmeticBackground(appearance.background)} profile-preview ${compact ? "preview-compact" : ""} pattern-${appearance.pattern.replace(/^pattern-/u, "")}`} aria-label="Предпросмотр профиля">
    {preview && <span className="preview-tag">Предпросмотр</span>}
    <div className="preview-head"><Avatar user={user} frame={frameItem?.slug ?? appearance.frame} size={compact ? "sm" : "lg"} /><div className="preview-name"><div><h2>{user.name}</h2>{emoji && <span className="name-emoji" aria-label="Выбранный эмодзи">{emoji}</span>}</div><span className="profile-username">{user.username ? `@${user.username}` : user.school?.name ?? "Ваше личное пространство"}</span>{title && <span className="profile-title">{title}</span>}</div><span className="level-chip">Уровень {user.level}</span></div>
      {!compact && <div className="preview-stats"><span><strong>{user.totalExp}</strong> EXP</span><span><strong>{user.balance}</strong> Эйнштейнов</span>{(className || schoolName) && <span>{className && <strong>{className}</strong>}{className && schoolName && " · "}{schoolName}</span>}</div>}
    {compact && <ExpBar totalExp={user.totalExp} level={user.level} compact />}
  </section>;
}

export function ProfileHero({ user, appearance, items, currentStreak, bestStreak }: { user: UserView; appearance: AppearanceView; items: Array<{ slug: string; displayName: string; value: string }>; currentStreak: number; bestStreak: number }) {
  return <GlassCard className="profile-hero-card"><ProfilePreview user={user} appearance={appearance} items={items} /><div className="profile-hero-bottom"><div className="hero-progress"><ExpBar totalExp={user.totalExp} level={user.level} /><div className="hero-meta"><BalanceBadge balance={user.balance} size="profile" /><StreakBadge current={currentStreak} best={bestStreak} /></div></div><a className="glass-button button-primary" href="/profile/customize">Настроить оформление <ArrowRight size={17} /></a></div></GlassCard>;
}

export type Cosmetic = { id: string; slug: string; type: string; unlockLevel: number; displayName: string; assetKey: string; value: string; groupKey?: string | null; opened: boolean; selected: boolean };
const unlockLabel = (level: number) => `Откроется с уровня ${level}`;

export function CosmeticCard({ item, isDraftSelected, onSelect }: { item: Cosmetic; isDraftSelected: boolean; onSelect: (item: Cosmetic) => void }) {
  const locked = !item.opened;
  return <button className={`cosmetic-card ${isDraftSelected ? "is-picked" : ""} ${locked ? "is-locked" : ""}`} onClick={() => onSelect(item)} aria-pressed={isDraftSelected} aria-label={`${item.displayName}, ${locked ? unlockLabel(item.unlockLevel).toLocaleLowerCase("ru-RU") : "открыто"}`}>
    <span className={`cosmetic-swatch swatch-${item.assetKey.replace(/[^a-z0-9-]/giu, "")}`}>
      {item.type === "NICK_EMOJI" ? <span className="swatch-emoji">{item.value || <Ban size={17} aria-hidden="true" />}</span> : item.type === "AVATAR_FRAME" ? <span className={`swatch-avatar ${frameClass(item.slug)}`}>В</span> : item.type === "PROFILE_TITLE" ? <span className="swatch-title">{item.value || <Ban size={17} aria-hidden="true" />}</span> : item.type === "PROFILE_PATTERN" ? <span className={`swatch-pattern-preview pattern-thumb-${item.slug.replace(/^pattern-/u, "")}`} aria-hidden="true">{item.slug === "pattern-none" && <Ban size={17} />}</span> : <span className="swatch-light" />}
      {locked && <span className="lock-mark"><LockKeyhole size={15} /></span>}
      {isDraftSelected && !locked && <span className="selected-mark"><Check size={13} /></span>}
    </span>
    <span className="cosmetic-meta"><strong>{item.displayName}</strong><small>{locked ? unlockLabel(item.unlockLevel) : isDraftSelected ? "Выбрано" : "Открыто"}</small></span>
  </button>;
}

export function FrameCosmeticCard({ item, isDraftSelected, onPreview, onApply, canApply }: { item: Cosmetic; isDraftSelected: boolean; onPreview: (item: Cosmetic) => void; onApply: (item: Cosmetic) => void; canApply: boolean }) {
  const locked = !item.opened;
  return <article className={`frame-cosmetic-card ${isDraftSelected ? "is-picked" : ""} ${locked ? "is-locked" : ""}`}>
    <button type="button" className="frame-cosmetic-preview" onClick={() => onPreview(item)} aria-label={`Предпросмотр рамки «${item.displayName}»`} aria-pressed={isDraftSelected}>
      <span className={`cosmetic-swatch swatch-${item.assetKey.replace(/[^a-z0-9-]/giu, "")}`}><span className={`swatch-avatar ${frameClass(item.slug)}`}>В</span>{locked && <span className="lock-mark"><LockKeyhole size={15} /></span>}</span>
      <span className="frame-cosmetic-copy"><strong>{item.displayName}</strong><small>{locked ? unlockLabel(item.unlockLevel) : isDraftSelected ? "Выбрано в предпросмотре" : "Открыто"}</small></span>
    </button>
    {!locked && <button type="button" className="frame-apply-button" disabled={!canApply} onClick={() => onApply(item)}>Применить</button>}
  </article>;
}

export function LevelPath({ totalExp, level, items, showAll = false }: { totalExp: number; level: number; items: Cosmetic[]; showAll?: boolean }) {
  const rows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].filter((value) => showAll || value <= level + 3);
  const names = (number: number) => items.filter((item) => item.unlockLevel === number).map((item) => item.displayName).join(" · ");
  const next = (level + 1) ** 2 - 1;
  return <div className="level-path"><div className="level-path-summary"><span className="level-orbit">{level}</span><div><strong>Твой личный путь</strong><span>Ещё {Math.max(0, next - totalExp)} EXP — и появится новый шаг.</span></div></div><ol>{rows.map((step) => { const threshold = step * step - 1; const done = totalExp >= threshold; return <li key={step} className={done ? "path-done" : ""}><span className="path-dot">{done ? <Check size={14} /> : step}</span><div><strong>Уровень {step}</strong><small>{step === 1 ? "Базовое оформление" : names(step) || "Новые варианты профиля"}</small></div><span className="path-exp">{threshold} EXP</span></li>; })}</ol></div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-orb" aria-hidden="true">✦</span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const timeout = window.setTimeout(onClose, 4200); return () => window.clearTimeout(timeout); }, [message, onClose]);
  if (!message) return null;
  return <div className="toast" role="status"><Check size={17} />{message}<button aria-label="Закрыть уведомление" onClick={onClose}><X size={15} /></button></div>;
}

export function LinkButton({ href, children }: { href: string; children: ReactNode }) { return <a className="text-link" href={href}>{children}<ChevronRight size={15} /></a>; }
