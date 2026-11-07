import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Coins, Compass, FileCheck2, Gift, Heart, Home, ImagePlus, LayoutDashboard, LogOut, Menu, MessageCircle, PackageCheck, Palette, Plus, Search, Settings2, ShieldCheck, Sparkles, Store, Trash2, UserRound, Users, X } from "lucide-react";
import { api, jsonBody } from "./api";
import { Avatar, BalanceBadge, CosmeticCard, EmptyState, ExpBar, FrameCosmeticCard, GlassButton, GlassCard, GlassDrawer, GlassInput, GlassModal, LevelPath, ProfileHero, ProfilePreview, StatusBadge, Toast, type AppearanceView, type Cosmetic, type UserView } from "./components";
import { useThemeMode, type ThemeMode } from "./theme";
import { LegalAcceptanceGate, LegalFooter, LegalSite } from "./legal-pages";
import { OwnerLegalSettingsPage, OwnerPartnersPage, PartnersPage } from "./cooperation-pages";
import { FaqPage, OwnerFaqPage } from "./faq-pages";
import { DocumentsPage, ReviewsPage } from "./library-pages";

const GradeBarChart = lazy(() => import("./charts").then((module) => ({ default: module.GradeBarChart })));
const GradePieChart = lazy(() => import("./charts").then((module) => ({ default: module.GradePieChart })));

const manualMaxLoginKey = "vibe_manual_max_login";
function shouldWaitForMaxLogin() {
  try { if (window.localStorage.getItem(manualMaxLoginKey) === "1") return true; } catch { /* Continue with other available storage. */ }
  try { if (window.sessionStorage.getItem(manualMaxLoginKey) === "1") return true; } catch { /* Continue with cookies. */ }
  try { return document.cookie.split("; ").some((entry) => entry === `${manualMaxLoginKey}=1`); } catch { return false; }
}
function setManualMaxLogin(required: boolean) {
  try { if (required) window.localStorage.setItem(manualMaxLoginKey, "1"); else window.localStorage.removeItem(manualMaxLoginKey); } catch { /* Other storage may still be available. */ }
  try { if (required) window.sessionStorage.setItem(manualMaxLoginKey, "1"); else window.sessionStorage.removeItem(manualMaxLoginKey); } catch { /* Cookies provide a fallback. */ }
  try { document.cookie = `${manualMaxLoginKey}=${required ? "1" : ""}; Path=/; SameSite=Lax; Max-Age=${required ? 31536000 : 0}${window.location.protocol === "https:" ? "; Secure" : ""}`; } catch { /* The storage options above remain available. */ }
}

type ToastHook = { message: string; show: (message: string) => void; close: () => void };
type MaxBridge = { initData?: string; initDataUnsafe?: { start_param?: string }; ready?: () => void; expand?: () => void; getViewportSize?: () => Promise<{ width: string; height: string }>; BackButton?: { show: () => void; hide: () => void; onClick: (handler: () => void) => void; offClick: (handler: () => void) => void } };
function useToast(): ToastHook {
  const [message, setMessage] = useState("");
  return { message, show: setMessage, close: () => setMessage("") };
}

type SessionResponse = { authenticated: boolean; authSource?: "MAX" | "TEST"; user?: UserView & { id: string; role: string | null; membershipId: string | null; isTeacher?: boolean; isSchoolAdmin?: boolean; school?: { id: string; name: string; city: string; timezone: string } | null; class?: { id: string; name: string } | null; appearance?: AppearanceView; preferences?: Record<string, unknown> } };

function ErrorState({ title = "Не удалось загрузить данные", detail, retry }: { title?: string; detail?: string; retry?: () => void }) {
  return <GlassCard className="error-card"><span className="error-symbol">!</span><div><strong>{title}</strong><p>{detail ?? "Проверьте соединение и попробуйте ещё раз."}</p>{retry && <GlassButton variant="secondary" onClick={retry}>Повторить</GlassButton>}</div></GlassCard>;
}

function LoadingState({ label = "Загружаем данные" }: { label?: string }) { return <div className="loading-state"><span className="loader-orb" /><span>{label}…</span></div>; }

function PageHeading({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{detail && <p>{detail}</p>}</div>{action}</div>;
}

function NavLink({ href, children, icon, active = false, onClick }: { href: string; children: React.ReactNode; icon: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return <a href={href} onClick={onClick} className={`nav-link ${active ? "is-active" : ""}`}>{icon}<span>{children}</span>{active && <span className="nav-current-dot" />}</a>;
}

function AppShell({ user, children, active, toast, preferences, themeMode, onThemeModeChange }: { user: NonNullable<SessionResponse["user"]>; children: React.ReactNode; active: string; toast: ToastHook; preferences?: Record<string, unknown> | null; themeMode: ThemeMode; onThemeModeChange: (mode: ThemeMode) => void }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const notificationCount = useQuery({ queryKey: ["notifications"], queryFn: () => api<any>("/notifications"), refetchInterval: 60_000 });
  const logout = useMutation({ mutationFn: () => api("/auth/logout", { method: "POST" }), onSuccess: () => { setManualMaxLogin(true); window.location.href = "/"; }, onError: () => toast.show("Не удалось завершить сеанс") });
  const frame = user.appearance?.frame ?? "frame-none";
  const role = user.role ?? "STUDENT";
  const roleLabel: Record<string, string> = { STUDENT: "Ученик", TEACHER: "Учитель", SCHOOL_ADMIN: "Администратор школы", PROJECT_OWNER: "Владелец проекта" };
  useEffect(() => {
    document.documentElement.classList.toggle("reduce-transparency", preferences?.reduceTransparency === true);
    document.documentElement.classList.toggle("reduce-motion", preferences?.reduceMotion === true);
    document.documentElement.classList.toggle("high-contrast", preferences?.highContrast === true);
    document.documentElement.classList.toggle("focus-mode", preferences?.focusMode === true);
  }, [preferences]);
  const closeDrawer = () => setDrawerOpen(false);
  return <div className="app-frame">
    <header className="topbar">
      <button className="icon-button top-menu" aria-label="Открыть главное меню" onClick={() => setDrawerOpen(true)}><Menu size={22} /></button>
      <a className="brand-lockup" href="/tasks"><img className="brand-image" src="/brand/vibe-logo.png" alt="Вайб" /><small>школьная жизнь интереснее</small></a>
      <div className="topbar-spacer" />
      <button className="notification-trigger" aria-label={`Уведомления${notificationCount.data?.unread ? `, непрочитанных: ${notificationCount.data.unread}` : ""}`} onClick={() => { setSettingsOpen(false); setNotificationsOpen(true); }}>{notificationCount.data?.unread > 0 && <span className="notification-dot" />}<MessageCircle size={19} /></button>
      <BalanceBadge balance={user.balance} />
      <a className="top-avatar-link" href="/profile" aria-label="Открыть профиль"><Avatar user={user} frame={frame} size="sm" /></a>
    </header>
    <GlassDrawer open={drawerOpen} onClose={closeDrawer}>
      <div className="drawer-top"><a className="brand-lockup" href="/tasks"><img className="brand-image" src="/brand/vibe-logo.png" alt="Вайб" /></a><button className="icon-button" aria-label="Закрыть меню" onClick={closeDrawer}><X size={20} /></button></div>
      <a className="drawer-profile" href="/profile"><Avatar user={user} frame={frame} /><span className="drawer-name"><strong>{user.name} {user.appearance?.emoji && user.appearance.emoji !== "emoji-none" ? "" : ""}</strong><small>{user.username ? `@${user.username}` : user.school?.name ?? roleLabel[role]}</small><ExpBar totalExp={user.totalExp} level={user.level} compact /></span><ChevronRight size={16} /></a>
      {user.appearance?.title && user.appearance.title !== "title-none" && <div className="drawer-title">{user.appearance.title}</div>}
      <nav className="drawer-nav" aria-label="Разделы"><span className="nav-caption">МОЁ ПРОСТРАНСТВО</span>
        <NavLink href="/tasks" icon={<BookOpen size={19} />} active={active === "tasks"} onClick={closeDrawer}>Задания</NavLink>
        <NavLink href="/profile" icon={<UserRound size={19} />} active={active === "profile"} onClick={closeDrawer}>Профиль</NavLink>
        <NavLink href="/market" icon={<Store size={19} />} active={active === "market"} onClick={closeDrawer}>Маркетплейс</NavLink>
        <NavLink href="/profile/customize" icon={<Palette size={19} />} active={active === "customize"} onClick={closeDrawer}>Оформление</NavLink>
        <NavLink href="/about" icon={<CircleHelp size={19} />} active={active === "about"} onClick={closeDrawer}>О нас</NavLink>
        <NavLink href="/faq" icon={<CircleHelp size={19} />} active={active === "faq"} onClick={closeDrawer}>Вопросы и ответы</NavLink>
        <NavLink href="/documents" icon={<FileCheck2 size={19} />} active={active === "documents"} onClick={closeDrawer}>Документы</NavLink>
        <NavLink href="/reviews" icon={<MessageCircle size={19} />} active={active === "reviews"} onClick={closeDrawer}>Отзывы</NavLink>
        <NavLink href="/partners" icon={<Users size={19} />} active={active === "partners"} onClick={closeDrawer}>Сотрудничество</NavLink>
        <span className="nav-caption nav-caption-spaced">РАЗДЕЛЫ ПО РОЛИ</span>
        {(user.isTeacher || role === "TEACHER") && <NavLink href="/teacher" icon={<FileCheck2 size={19} />} active={active === "teacher"} onClick={closeDrawer}>Кабинет учителя</NavLink>}
        {(user.isSchoolAdmin || role === "SCHOOL_ADMIN") && <NavLink href="/admin" icon={<Users size={19} />} active={active === "admin"} onClick={closeDrawer}>Панель школы</NavLink>}
        {role === "PROJECT_OWNER" && <><NavLink href="/owner" icon={<LayoutDashboard size={19} />} active={active === "owner" && window.location.pathname === "/owner"} onClick={closeDrawer}>Панель владельца</NavLink><NavLink href="/owner/schools" icon={<Home size={19} />} active={window.location.pathname.startsWith("/owner/schools")} onClick={closeDrawer}>Школы</NavLink><NavLink href="/owner/users" icon={<Users size={19} />} active={window.location.pathname === "/owner/users"} onClick={closeDrawer}>Пользователи</NavLink><NavLink href="/owner/faq" icon={<CircleHelp size={19} />} active={window.location.pathname === "/owner/faq"} onClick={closeDrawer}>Редактор FAQ</NavLink><NavLink href="/owner/legal" icon={<ShieldCheck size={19} />} active={window.location.pathname === "/owner/legal"} onClick={closeDrawer}>Юридическая информация</NavLink><NavLink href="/owner/partners" icon={<Users size={19} />} active={window.location.pathname === "/owner/partners"} onClick={closeDrawer}>Сотрудничество</NavLink></>}
      </nav>
      <div className="drawer-bottom"><button className="drawer-action" onClick={() => { setNotificationsOpen(false); setSettingsOpen(true); }}><Settings2 size={18} /> Настройки</button><span className="drawer-user-label">{roleLabel[role]}{user.class?.name ? ` · ${user.class.name}` : ""}</span><button className="drawer-action logout-action" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut size={18} /> Завершить сеанс</button></div>
    </GlassDrawer>
    <main className={`page-main page-${active}`}>{children}</main>
    <LegalFooter className="app-shell-footer" />
    {createPortal(<nav className="bottom-nav" aria-label="Основная навигация"><NavLink href="/tasks" icon={<BookOpen size={19} />} active={active === "tasks"}>Задания</NavLink><NavLink href="/profile" icon={<UserRound size={19} />} active={active === "profile"}>Профиль</NavLink><NavLink href="/market" icon={<Store size={19} />} active={active === "market"}>Маркет</NavLink></nav>, document.body)}
    <GlassModal open={notificationsOpen} title="Уведомления" onClose={() => setNotificationsOpen(false)}><NotificationInbox open={notificationsOpen} toast={toast} /></GlassModal>
    <GlassModal open={settingsOpen} title="Настройки" onClose={() => setSettingsOpen(false)}><SettingsPanel toast={toast} themeMode={themeMode} onThemeModeChange={onThemeModeChange} /></GlassModal>
    <Toast message={toast.message} onClose={toast.close} />
  </div>;
}

function NotificationInbox({ open, toast }: { open: boolean; toast: ToastHook }) {
  const queryClient = useQueryClient();
  const feed = useQuery({ queryKey: ["notifications"], queryFn: () => api<any>("/notifications"), enabled: open, refetchOnMount: "always" });
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api<any>("/profile"), enabled: open });
  const botStatus = useQuery({ queryKey: ["bot-status"], queryFn: () => api<any>("/bot/status"), enabled: open, refetchInterval: 60_000 });
  const markRead = useMutation({ mutationFn: (id: string) => api(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ["notifications"] }); }, onError: (error: Error) => toast.show(error.message) });
  const connection = profile.data?.user?.maxConnection;
  const prefs = profile.data?.preferences;
  const maxReady = botStatus.data?.transport === "max" && botStatus.data?.enabled === true && botStatus.data?.configured === true;
  const deliveryStatus = !connection?.connected ? "Аккаунт не связан с MAX" : botStatus.isLoading ? "Проверяем состояние MAX-бота" : botStatus.isError ? "Не удалось проверить состояние MAX-бота" : !maxReady ? "Отправка в MAX не настроена" : !connection.botStarted ? "Бот не запущен" : prefs?.maxNotificationsEnabled === false ? "Уведомления MAX выключены" : "MAX-бот готов к отправке";
  const deliveryDetail = !connection?.connected ? "Личные сообщения MAX доступны после привязки аккаунта через безопасный вход." : botStatus.isLoading ? "Проверяем, готов ли бот отправлять личные события." : botStatus.isError ? "События остаются в приложении; попробуй проверить статус позже." : !maxReady ? "Личная доставка включается, когда MAX-бот настроен на сервере." : !connection.botStarted ? "Открой бота Вайба и нажми «Запустить», чтобы получать личные события." : prefs?.maxNotificationsEnabled === false ? "Включи уведомления в настройках приложения, если захочешь получать сообщения." : "Личные события о заданиях и проверке могут приходить в диалог с ботом.";
  const destination: Record<string, string> = { TASKS: "/tasks", ORDERS: "/market", PROGRESS: "/profile", COSMETICS: "/profile/customize" };
  const openNotification = (item: any) => {
    const href = destination[item.kind] ?? "/tasks";
    if (item.readAt) { window.location.href = href; return; }
    markRead.mutate(item.id, { onSuccess: () => { window.location.href = href; } });
  };
  const items = Array.isArray(feed.data?.items) ? feed.data.items : [];
  return <div className="settings-panel">
    <p className="modal-intro">События Вайба отображаются здесь. Личные сообщения в MAX доставляет бот, если аккаунт связан, бот запущен и уведомления разрешены.</p>
    <div className="max-connection-note" role="status"><strong>{deliveryStatus}</strong><small>{deliveryDetail}</small></div>
    {feed.isLoading ? <LoadingState label="Загружаем события" /> : feed.isError ? <ErrorState detail={(feed.error as Error).message} retry={() => void feed.refetch()} /> : items.length === 0 ? <div className="settings-empty">Новых событий пока нет.</div> : <div className="notification-list">{items.map((item: any) => <button className={`notification-item ${item.readAt ? "is-read" : ""}`} key={item.id} onClick={() => openNotification(item)} disabled={markRead.isPending}><strong>{item.title}</strong><span>{item.body}</span><small>{new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.createdAt))} · Открыть раздел</small></button>)}</div>}
  </div>;
}

function SettingsPanel({ toast, themeMode, onThemeModeChange }: { toast: ToastHook; themeMode: ThemeMode; onThemeModeChange: (mode: ThemeMode) => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["profile"], queryFn: () => api<any>("/profile") });
  const prefs = query.data?.preferences;
  const maxConnection = query.data?.user?.maxConnection;
  const botStatus = useQuery({ queryKey: ["bot-status"], queryFn: () => api<any>("/bot/status"), refetchInterval: 60_000 });
  const maxDeliveryConfigured = botStatus.data?.transport === "max" && botStatus.data?.enabled === true && botStatus.data?.configured === true;
  const mutation = useMutation({ mutationFn: (body: Record<string, unknown>) => api<any>("/profile/preferences", { method: "PUT", body: jsonBody(body) }), onSuccess: (data) => { queryClient.setQueryData(["profile"], (old: any) => ({ ...old, preferences: data.preferences })); queryClient.invalidateQueries({ queryKey: ["session"] }); toast.show("Настройки сохранены"); }, onError: (error: Error) => toast.show(error.message) });
  const change = (key: string, value: boolean) => mutation.mutate({ [key]: value });
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState detail={(query.error as Error).message} retry={() => void query.refetch()} />;
  return <div className="settings-panel">
    <p className="modal-intro">Тема сохраняется в этом браузере отдельно от косметики профиля. Системный режим следует настройке устройства.</p>
    <fieldset className="theme-setting"><legend>Тема интерфейса</legend><div className="theme-options" role="group" aria-label="Тема интерфейса">{([{ value: "light", label: "Светлая" }, { value: "dark", label: "Тёмная" }, { value: "system", label: "Системная" }] as const).map((option) => <button type="button" key={option.value} aria-pressed={themeMode === option.value} className={themeMode === option.value ? "is-selected" : ""} onClick={() => onThemeModeChange(option.value)}>{option.label}</button>)}</div></fieldset>
    <p className="modal-intro">Настройки доступности сохраняются независимо от темы.</p>
    <Toggle label="Уменьшить прозрачность" detail="Карточки становятся плотнее и контрастнее." value={prefs?.reduceTransparency ?? false} onChange={(value) => change("reduceTransparency", value)} />
    <Toggle label="Усилить контраст" detail="Добавляет более выразительные границы и текст." value={prefs?.highContrast ?? false} onChange={(value) => change("highContrast", value)} />
    <Toggle label="Отключить декоративные анимации" detail="Сохраняет анимацию только там, где она помогает понять действие." value={prefs?.reduceMotion ?? false} onChange={(value) => change("reduceMotion", value)} />
    <Toggle label="Сосредоточиться" detail="Убирает украшения во время решения работы, не останавливая срок." value={prefs?.focusMode ?? false} onChange={(value) => change("focusMode", value)} />
    <Toggle label="Уведомления в MAX" detail="Сообщения о заданиях и результатах будут приходить в бот. Их можно выключить в любой момент." value={prefs?.maxNotificationsEnabled ?? true} disabled={mutation.isPending} onChange={(value) => change("maxNotificationsEnabled", value)} />
    <div className="max-connection-note" role="status"><strong>{!maxConnection?.connected ? "Свяжи аккаунт с MAX" : !maxDeliveryConfigured ? "Отправка MAX пока не настроена" : !maxConnection.botStarted ? "Запусти бота Вайба в MAX" : prefs?.maxNotificationsEnabled === false ? "Уведомления MAX выключены" : "MAX-бот готов к отправке"}</strong><small>{!maxConnection?.connected ? "Персональные сообщения доступны после безопасной привязки аккаунта через MAX." : !maxDeliveryConfigured ? "Сайт отправляет личные события через MAX-бота; сейчас сервер не подтвердил готовность отправки." : !maxConnection.botStarted ? "Открой бота Вайба и нажми «Запустить», чтобы получать личные события." : prefs?.maxNotificationsEnabled === false ? "Сохранённый отказ не меняется. Если захочешь, включи уведомления переключателем выше." : "Личные события о заданиях и проверке могут приходить в диалог с ботом."}</small></div>
  </div>;
}

function Toggle({ label, detail, value, onChange, disabled = false }: { label: string; detail?: string; value: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className={`toggle-row ${disabled ? "is-disabled" : ""}`}><span className="toggle-copy"><strong>{label}</strong>{detail && <small>{detail}</small>}</span><input type="checkbox" checked={value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} aria-label={label} /><span className="toggle-track" aria-hidden="true" /></label>;
}

function LoginScreen({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const testTriggerRef = useRef<HTMLButtonElement>(null);
  const testDialogRef = useRef<HTMLElement>(null);
  const status = useQuery({ queryKey: ["auth-status"], queryFn: () => api<any>("/auth/status"), retry: false });
  const [testOpen, setTestOpen] = useState(false);
  const profiles = useQuery({ queryKey: ["test-profiles"], queryFn: () => api<any[]>("/auth/test/profiles"), enabled: testOpen, retry: false });
  const enter = useMutation({ mutationFn: (profileKey: string) => api<{ redirectTo: string }>("/auth/test/session", { method: "POST", body: jsonBody({ profileKey }) }), onSuccess: (result) => { client.clear(); window.location.href = result.redirectTo; }, onError: (error: Error) => toast.show(error.message) });
  const webApp = (window as Window & { WebApp?: { initData?: string; initDataUnsafe?: { start_param?: string } } }).WebApp;
  const startParam = webApp?.initDataUnsafe?.start_param ?? "";
  const launchPath = maxLaunchPath(startParam);
  useEffect(() => {
    if (!testOpen) return;
    const returnFocus = testTriggerRef.current;
    const dialog = testDialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setTestOpen(false); return; }
      if (event.key !== "Tab") return;
      const nodes = focusable();
      if (!nodes.length) { event.preventDefault(); dialog?.focus(); return; }
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); returnFocus?.focus(); };
  }, [testOpen]);
  useEffect(() => {
    if (testOpen && !profiles.isLoading && !profiles.isError) testDialogRef.current?.querySelector<HTMLElement>(".test-profile-card:not(:disabled)")?.focus();
  }, [testOpen, profiles.isLoading, profiles.isError, profiles.data?.length]);
  useEffect(() => {
    if (!testOpen) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
    };
  }, [testOpen]);
  useEffect(() => {
    if (webApp?.initData && status.data?.maxConfigured && !shouldWaitForMaxLogin()) {
      void api("/auth/max", { method: "POST", body: jsonBody({ initData: webApp.initData }) }).then(() => { client.clear(); window.location.href = launchPath ?? "/tasks"; }).catch((error: Error) => toast.show(error.message));
    }
  }, [Boolean(webApp?.initData), status.data?.maxConfigured, launchPath]);
  const maxLogin = () => {
    if (!status.data?.maxAppConfigured) { toast.show("MAX не подключён. Попробуйте войти позже или выберите тестовый профиль."); return; }
    if (webApp?.initData) void api("/auth/max", { method: "POST", body: jsonBody({ initData: webApp.initData }) }).then(() => { setManualMaxLogin(false); client.clear(); window.location.href = launchPath ?? "/tasks"; }).catch((error: Error) => toast.show(error.message));
    else { setManualMaxLogin(false); window.location.href = "https://max.ru/ideya_fiks_75_bot"; }
  };
  return <div className="login-shell"><div className="login-page"><div className="ambient-orb orb-one" /><div className="ambient-orb orb-two" /><div className="login-layout">
    <div className="brand-lockup brand-large login-brand"><img className="brand-image" src="/brand/vibe-logo.png" alt="Вайб" /><small>школьная жизнь интереснее</small></div>
    <div className="login-story"><div className="mission-card"><div className="login-art-stage" aria-hidden="true"><span className="login-art-orb" /><span className="login-art-crystal" /><span className="login-art-spark">✦</span><span className="login-art-star">✧</span></div><span className="mission-kicker"><Sparkles size={19} /> МИССИЯ ВАЙБА</span><h1>Каждому —<br /><em>свой путь.</em></h1><p>Интересные задания, реальные усилия и маленькие открытия каждый день.</p><div className="mission-pill"><span>01</span> личный прогресс без рейтингов</div><div className="mission-pill"><span>02</span> выбор за активности и старание</div><div className="mission-pill"><span>03</span> поддержка учителя</div><div className="mission-note">Вайб поощряет усилия и достижения —<br />вместо гонки за статусом.</div></div></div>
    <GlassCard className="login-card"><div className="login-card-header"><span className="overline">РАДЫ ВАС ВИДЕТЬ</span><h2>Войти в Вайб</h2><p>Войдите в личный профиль через MAX{status.data?.testLoginEnabled ? " или выберите тестовый профиль." : " или откройте демонстрационный режим."}</p></div>
      <div className="login-method"><div className="login-method-top"><span className="max-mark" aria-hidden="true"><img src="/brand/max-logo.png" alt="" /></span><div><strong>Настоящий аккаунт</strong><small>Вход через MAX с подтверждением в приложении</small></div></div>
        <GlassButton className="full-width" onClick={maxLogin}>Войти через MAX</GlassButton>
      </div>
      <div className="test-access"><p>{status.data?.testLoginEnabled ? "Выберите тестовый профиль, чтобы познакомиться с возможностями Вайба." : "Тестовый вход доступен в демонстрационной версии."}</p><button ref={testTriggerRef} type="button" className="glass-button button-secondary full-width" onClick={() => { if (!status.data?.testLoginEnabled) { toast.show("Тестовые профили доступны в демонстрационной версии."); return; } setTestOpen(true); }}>Тест</button></div>
      <div className="login-privacy"><ShieldCheck size={16} /><span>Личные работы, баланс и оформление доступны только владельцу аккаунта.</span></div>
    </GlassCard>
    {testOpen && createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setTestOpen(false); }}><section ref={testDialogRef} className="glass-modal test-profile-modal" role="dialog" aria-modal="true" aria-labelledby="test-profile-title" tabIndex={-1}><header><h2 id="test-profile-title">Тестовые профили</h2><button className="icon-button" aria-label="Закрыть окно" onClick={() => setTestOpen(false)}><X size={20} /></button></header><p className="modal-intro">Это учебные аккаунты для знакомства с Вайбом. Они не связаны с вашим аккаунтом MAX.</p><div className="test-profile-list">{profiles.isLoading ? <LoadingState label="Проверяем тестовые профили" /> : profiles.isError ? <ErrorState title="Не удалось открыть тестовые профили" detail={(profiles.error as Error).message} retry={() => void profiles.refetch()} /> : profiles.data?.map((profile) => <button key={profile.key} className="test-profile-card" disabled={!profile.available || enter.isPending} onClick={() => enter.mutate(profile.key)}><span className="test-profile-avatar">{profile.key === "user-1" ? <UserRound size={22} /> : profile.key === "user-2" ? <FileCheck2 size={22} /> : profile.key === "user-4" ? <LayoutDashboard size={22} /> : <ShieldCheck size={22} />}</span><span><strong>{profile.name}</strong><small>{profile.role === "STUDENT" ? "Ученик" : profile.role === "TEACHER" ? "Учитель · 7A" : profile.role === "PROJECT_OWNER" ? "Владелец проекта" : "Администратор школы"}{profile.schoolName ? ` · ${profile.schoolName}` : ""}</small></span><span className="test-profile-enter">{enter.isPending ? "Входим…" : "Войти"}</span><ArrowRight size={18} /></button>)}</div><p className="local-only-note">Доступны четыре подготовленных профиля. Они не связаны с вашим аккаунтом MAX.</p></section></div>, document.body)}
  </div><LegalFooter className="login-legal-footer" /><Toast message={toast.message} onClose={toast.close} /></div></div>;
}

function maxLaunchPath(startParam: string): string | null {
  if (!startParam.startsWith("vibe_route_")) return null;
  const routes: Record<string, string> = {
    home: "/tasks", tasks: "/tasks", profile: "/profile", about: "/about",
    market: "/market", faq: "/faq", support: "/faq", settings: "/profile#settings",
  };
  return routes[startParam.slice("vibe_route_".length)] ?? null;
}

function TasksPage() {
  const query = useQuery({ queryKey: ["tasks"], queryFn: () => api<any>("/tasks") });
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState detail={(query.error as Error).message} retry={() => void query.refetch()} />;
  const tasks = query.data.tasks ?? [];
  const filters = [{ id: "ALL", label: "Все" }, { id: "AVAILABLE", label: "Доступные" }, { id: "IN_PROGRESS", label: "В работе" }, { id: "SUBMITTED", label: "На проверке" }, { id: "RETURNED", label: "Доработка" }, { id: "COMPLETED", label: "Завершённые" }, { id: "OVERDUE", label: "Просроченные" }];
  const filtered = tasks.filter((task: any) => (filter === "ALL" || task.status === filter) && `${task.title} ${task.subject} ${task.category}`.toLocaleLowerCase("ru-RU").includes(search.toLocaleLowerCase("ru-RU")));
  return <div className="content-stack"><PageHeading eyebrow="МОЁ ПРОСТРАНСТВО" title="Задания" detail="Выбирай интересные работы и отмечай собственный прогресс." action={<span className="assignment-count"><BookOpen size={17} /> {tasks.length} назначено</span>} />
    {query.data.nextAction && <a href={query.data.nextAction.href} className={`next-action-card next-${query.data.nextAction.kind.toLowerCase()}`}><span className="next-action-icon"><Compass size={20} /></span><span className="next-action-copy"><small>ЧТО ДАЛЬШЕ?</small><strong>{query.data.nextAction.title}</strong><span>{query.data.nextAction.detail}</span></span><ArrowRight size={19} /></a>}
    <div className="task-toolbar"><div className="filter-scroll" role="tablist" aria-label="Фильтр заданий">{filters.map((item) => <button key={item.id} role="tab" aria-selected={filter === item.id} className={`filter-chip ${filter === item.id ? "active" : ""}`} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div><label className="search-box"><Search size={17} /><input ref={searchRef} aria-label="Поиск по заданиям" placeholder="Найти работу" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" className="search-clear" aria-label="Очистить поиск по заданиям" onClick={() => { setSearch(""); searchRef.current?.focus(); }}><X size={17} /></button>}</label></div>
    {!filtered.length ? <EmptyState title={search ? "Ничего не нашлось" : "Здесь пока тихо"} detail={search ? "Попробуйте другое название или категорию." : "Когда появятся новые работы, они будут здесь."} /> : <div className="task-grid">{filtered.map((task: any, index: number) => <GlassCard className={`task-card task-card-${index % 4}`} data-category-art={categorySlug(task.category)} key={task.id}>
      <div className="task-card-top"><span className={`category-icon category-${categorySlug(task.category)}`}>{categoryIcon(task.category)}</span><StatusBadge status={task.status} /></div>
      <span className="task-category">{task.category} · {task.subject}</span><h2>{task.title}</h2><p>{task.description ?? (task.hasLongAnswer ? "Добавь фото или опиши своё решение." : "Короткая работа с автоматической проверкой.")}</p>
      <div className="task-facts"><span><FileCheck2 size={15} />{task.questionCount} {plural(task.questionCount, "вопрос", "вопроса", "вопросов")}</span>{task.durationMinutes && <span><Clock3 size={15} />{task.durationMinutes} мин</span>}<span><Coins size={15} />{task.reward ?? "За оценку 4–5 — база 10, за 2–3 — база 5 Эйнштейнов · множитель серии · +1 EXP за первый зачёт"}</span></div>
      <div className="task-card-footer"><span>{task.dueAt ? `До ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(task.dueAt))}` : "Без общего срока"}</span><a className="round-link" href={`/tasks/${task.id}`} aria-label={`Открыть ${task.title}`}><ArrowRight size={18} /></a></div>
    </GlassCard>)}</div>}
    {query.data.waitingForReview > 0 && <p className="soft-footnote"><Clock3 size={15} /> {query.data.waitingForReview} работ ждут проверки учителя. Дни отправки {formatDayKeys(query.data.pendingActivityDays)} пока не входят в подтверждённую серию и не дали EXP.</p>}
  </div>;
}

function TaskPage({ assignmentId, toast }: { assignmentId: string; toast: ToastHook }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["task", assignmentId], queryFn: () => api<any>(`/tasks/${assignmentId}`) });
  const [answers, setAnswers] = useState<Record<string, { text: string; fileIds: string[] }>>({});
  const [saveState, setSaveState] = useState("");
  const [seconds, setSeconds] = useState<number | null>(null);
  const draftSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const draftSaveTimer = useRef<number | null>(null);
  const submittingRef = useRef(false);
  const submissionId = query.data?.submission?.id;
  useEffect(() => {
    if (!query.data) return;
    const next: Record<string, { text: string; fileIds: string[] }> = {};
    for (const question of query.data.questions) next[question.id] = { text: "", fileIds: [] };
    for (const answer of query.data.submission?.answers ?? []) next[answer.questionId] = { text: answer.text, fileIds: answer.fileIds };
    setAnswers(next);
  }, [query.data?.id, submissionId]);
  useEffect(() => {
    const deadline = query.data?.submission?.deadline;
    if (!deadline) { setSeconds(null); return; }
    const update = () => setSeconds(Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000)));
    update(); const interval = window.setInterval(update, 1000); return () => window.clearInterval(interval);
  }, [query.data?.submission?.deadline]);
  useEffect(() => {
    if (!submissionId || query.data?.submission?.status !== "IN_PROGRESS" || submittingRef.current) return;
    const values = Object.entries(answers).map(([questionId, answer]) => ({ questionId, ...answer }));
    if (!values.length || values.every((answer) => !answer.text && !answer.fileIds.length)) return;
    const timeout = window.setTimeout(() => {
      const saveDraft = async () => {
        setSaveState("Сохраняем черновик…");
        try {
          const result = await api<any>(`/tasks/${assignmentId}/draft`, { method: "PUT", headers: { "x-submission-id": submissionId }, body: jsonBody({ answers: values }) });
          setSaveState(`Сохранено ${new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(result.savedAt))}`);
        } catch (error) {
          setSaveState(`Не сохранено: ${(error as Error).message}`);
        }
      };
      draftSaveQueue.current = draftSaveQueue.current.catch(() => {}).then(saveDraft);
    }, 800);
    draftSaveTimer.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      if (draftSaveTimer.current === timeout) draftSaveTimer.current = null;
    };
  }, [answers, assignmentId, query.data?.submission?.status, submissionId]);
  const start = useMutation({ mutationFn: () => api(`/tasks/${assignmentId}/start`, { method: "POST" }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["task", assignmentId] }); void client.invalidateQueries({ queryKey: ["tasks"] }); }, onError: (error: Error) => toast.show(error.message) });
  const submit = useMutation({ mutationFn: async () => {
    submittingRef.current = true;
    if (draftSaveTimer.current !== null) {
      window.clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = null;
    }
    await draftSaveQueue.current;
    return api<any>(`/tasks/${assignmentId}/submit`, { method: "POST", headers: { "x-submission-id": submissionId ?? "" }, body: jsonBody({ answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, ...answer })) }) });
  }, onSuccess: (result) => { toast.show(result.status === "На проверке" ? "Работа отправлена учителю" : result.reward?.note ?? "Работа проверена"); void client.invalidateQueries({ queryKey: ["task", assignmentId] }); void client.invalidateQueries({ queryKey: ["tasks"] }); void client.invalidateQueries({ queryKey: ["profile"] }); void client.invalidateQueries({ queryKey: ["session"] }); }, onError: (error: Error) => toast.show(error.message), onSettled: () => { submittingRef.current = false; } });
  const upload = async (questionId: string, files: FileList | null) => {
    if (!files?.length) return;
    const chosen = Array.from(files).slice(0, 5);
    try {
      const form = new FormData(); chosen.forEach((file) => form.append("file", file));
      const result = await api<{ files: Array<{ id: string }> }>("/files", { method: "POST", body: form });
      setAnswers((current) => ({ ...current, [questionId]: { ...(current[questionId] ?? { text: "" }), fileIds: [...(current[questionId]?.fileIds ?? []), ...result.files.map((file) => file.id)].slice(0, 5) } }));
      toast.show("Фото добавлено в приватное хранилище");
    } catch (error) { toast.show((error as Error).message); }
  };
  if (query.isLoading) return <LoadingState label="Открываем задание" />;
  if (query.isError) return <ErrorState title="Работа недоступна" detail={(query.error as Error).message} retry={() => void query.refetch()} />;
  const work = query.data;
  const submission = work.submission;
  const active = submission?.status === "IN_PROGRESS";
  const canStart = !work.previewOnly && (!submission || ["RETURNED", "EXPIRED"].includes(submission.status));
  return <div className="content-stack task-detail-page"><PageHeading eyebrow={`${work.subject.toUpperCase()} · ${work.category.toUpperCase()}`} title={work.title} detail={work.description} action={<a className="glass-button button-quiet" href="/tasks"><ChevronRight size={16} className="back-chevron" /> Все задания</a>} />
    {work.photos?.length > 0 && <GlassCard className="assignment-photo-gallery" aria-label="Материалы задания"><h2>Материалы задания</h2><div>{work.photos.map((photo: any) => <a href={photo.url} target="_blank" rel="noreferrer" key={photo.id}><img src={photo.url} alt="Изображение к заданию" /></a>)}</div></GlassCard>}
    <div className="task-detail-grid"><div className="task-detail-main">
      <GlassCard className="task-conditions"><div className="conditions-heading"><span className="task-number">01</span><div><span className="overline">УСЛОВИЯ</span><h2>Решай в своём темпе</h2></div></div><div className="condition-pills"><span><Clock3 size={16} />{work.durationMinutes ? `${work.durationMinutes} минут после старта` : "Без таймера после старта"}</span><span><Coins size={16} />Оценка 4–5: 10 · 2–3: 5 Эйнштейнов + серия</span><span><Sparkles size={16} />+1 EXP за первый зачёт работы</span></div>{work.dueAt && <p className="deadline-note">Срок сдачи: {new Intl.DateTimeFormat("ru-RU", { dateStyle: "full", timeStyle: "short" }).format(new Date(work.dueAt))}. Таймер запускается после нажатия «Начать».</p>}
        {work.previewOnly && <div className="preview-warning"><ShieldCheck size={17} /> Предпросмотр учителя: ответы и награды учеников не показываются.</div>}
        {!submission && !work.previewOnly && <GlassButton onClick={() => start.mutate()} disabled={start.isPending}>{start.isPending ? "Запускаем…" : work.durationMinutes ? "Начать выполнение и запустить таймер" : "Начать выполнение"} <ArrowRight size={17} /></GlassButton>}
        {canStart && submission?.status === "RETURNED" && <GlassButton onClick={() => start.mutate()} disabled={start.isPending}>Начать доработку <ArrowRight size={17} /></GlassButton>}
      </GlassCard>
      {submission?.status === "SUBMITTED" && <GlassCard className="result-card result-pending"><span className="result-orb"><Clock3 size={20} /></span><div><StatusBadge status="SUBMITTED" /><h2>Работа у учителя</h2><p>Быстрые ответы уже сохранены, итоговая оценка и награда появятся после проверки.</p></div></GlassCard>}
      {submission?.status === "COMPLETED" && <GlassCard className="result-card"><span className="result-orb result-ok"><Check size={20} /></span><div><StatusBadge status="COMPLETED" /><h2>{submission.grade ? `Оценка ${submission.grade}` : "Работа завершена"}</h2><p>{submission.earnedPoints}/{submission.maxPoints} баллов{submission.teacherComment ? ` · ${submission.teacherComment}` : ""}</p>{submission.reward && <p className="reward-receipt">{submission.reward.note}</p>}</div></GlassCard>}
      {submission?.status === "RETURNED" && <GlassCard className="return-card"><span className="overline">ОБРАТНАЯ СВЯЗЬ</span><h2>Можно доработать</h2><p>{submission.teacherComment}</p>{submission.extendedDueAt && <small>Новый срок: {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(submission.extendedDueAt))}</small>}</GlassCard>}
      {(active || work.previewOnly) && <div className="question-list">{work.questions.map((question: any, index: number) => <GlassCard className="question-card" key={question.id}><div className="question-heading"><span className="question-index">{String(index + 1).padStart(2, "0")}</span><div><span className="overline">ВОПРОС · {question.points} {plural(question.points, "БАЛЛ", "БАЛЛА", "БАЛЛОВ")}</span><h2>{question.prompt}</h2></div></div>
        {active && question.type === "SINGLE_CHOICE" ? <fieldset className="choice-list"><legend>Выбери один вариант</legend>{question.options.map((option: string) => <label key={option} className={`choice-option ${answers[question.id]?.text === option ? "chosen" : ""}`}><input type="radio" name={question.id} value={option} checked={answers[question.id]?.text === option} onChange={() => setAnswers((current) => ({ ...current, [question.id]: { ...(current[question.id] ?? { fileIds: [] }), text: option } }))} />{option}</label>)}</fieldset> : active && question.type === "LONG_ANSWER" ? <div className="answer-fields"><textarea aria-label={`Ответ на вопрос ${index + 1}`} placeholder="Опиши своё решение или идею…" value={answers[question.id]?.text ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: { ...(current[question.id] ?? { fileIds: [] }), text: event.target.value } }))} />{question.photoRequired && <span className="field-helper">Для этого развёрнутого вопроса нужно хотя бы одно фото.</span>}<label className="upload-drop"><input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Добавить фото решения" onChange={(event) => void upload(question.id, event.currentTarget.files)} /><span className="upload-icon"><Plus size={19} /></span><strong>Добавить фото решения</strong><small>JPEG, PNG или WebP · до 10 МБ на фото</small></label>{(answers[question.id]?.fileIds?.length ?? 0) > 0 && <div className="uploaded-files">{answers[question.id]!.fileIds.map((id) => <span key={id}><img src={`/api/files/${id}`} alt="Фото решения" /><button type="button" aria-label="Удалить фото" onClick={() => setAnswers((current) => ({ ...current, [question.id]: { ...current[question.id]!, fileIds: current[question.id]!.fileIds.filter((fileId) => fileId !== id) } }))}><X size={14} /></button></span>)}</div>}</div> : active && question.type === "NUMBER" ? <label className="field answer-input"><span>Твой ответ</span><input inputMode="decimal" placeholder="Например, 12" value={answers[question.id]?.text ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: { ...(current[question.id] ?? { fileIds: [] }), text: event.target.value } }))} /></label> : active ? <label className="field answer-input"><span>Твой ответ</span><input placeholder="Напиши короткий ответ" value={answers[question.id]?.text ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: { ...(current[question.id] ?? { fileIds: [] }), text: event.target.value } }))} /></label> : <p className="preview-only-text">{submission?.answers?.find((answer: any) => answer.questionId === question.id)?.text || "Ответ появится после сдачи."}</p>}
      </GlassCard>)}</div>}
      {active && <div className="submission-bar"><div className="save-status"><span className={saveState.startsWith("Не") ? "save-error-dot" : "save-dot"} />{saveState || "Ответы сохраняются на сервере по мере ввода"}</div>{seconds !== null && <strong className={`timer-readout ${seconds < 60 ? "timer-warning" : ""}`}><Clock3 size={17} />{formatSeconds(seconds)}</strong>}<GlassButton onClick={() => submit.mutate()} disabled={submit.isPending || seconds === 0}>{submit.isPending ? "Отправляем…" : "Сдать работу"}<ArrowRight size={17} /></GlassButton></div>}
    </div><aside className="task-detail-aside"><GlassCard className="task-help-card"><span className="aside-icon"><CircleHelp size={19} /></span><h3>Нужна помощь?</h3><p>Если срок или условие непонятны, обратись к своему учителю.</p></GlassCard><GlassCard className="task-points-card"><span className="overline">ЗА ЭТУ РАБОТУ</span><div><Coins size={20} /><strong>4–5: 10 · 2–3: 5 <small>Эйнштейнов</small></strong></div><div><Sparkles size={20} /><strong>+1 <small>EXP</small></strong></div><p>К сумме применяется множитель серии до ×1,5. EXP начисляется один раз после первого зачёта этой работы.</p></GlassCard></aside></div>
    
  </div>;
}

function ProfilePage({ user, toast }: { user: NonNullable<SessionResponse["user"]>; toast: ToastHook }) {
  const client = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api<any>("/profile") });
  const customize = useQuery({ queryKey: ["customize"], queryFn: () => api<any>("/profile/customize") });
  const [goal, setGoal] = useState("2");
  const [pinned, setPinned] = useState<string[]>([]);
  const saveGoal = useMutation({ mutationFn: (target: number | null) => api("/profile/weekly-goal", { method: "PUT", body: jsonBody({ target }) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["profile"] }); toast.show("Личная цель недели сохранена"); }, onError: (error: Error) => toast.show(error.message) });
  const savePins = useMutation({ mutationFn: (achievementIds: string[]) => api("/profile/pinned-achievements", { method: "PUT", body: jsonBody({ achievementIds }) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["profile"] }); toast.show("Личная витрина обновлена"); }, onError: (error: Error) => toast.show(error.message) });
  useEffect(() => { if (profile.data?.weeklyGoal?.target) setGoal(String(profile.data.weeklyGoal.target)); if (profile.data?.pinnedAchievements) setPinned(profile.data.pinnedAchievements.map((item: any) => item.id)); }, [profile.data?.weeklyGoal?.target, profile.data?.pinnedAchievements?.length]);
  if (profile.isLoading || customize.isLoading) return <LoadingState label="Собираем профиль" />;
  if (profile.isError) return <ErrorState detail={(profile.error as Error).message} retry={() => void profile.refetch()} />;
  const data = profile.data;
  const view = { ...user, ...data.user } as UserView;
  const appearance = data.appearance ?? { background: "pearl", emoji: "emoji-none", frame: "frame-none", title: "title-none", pattern: "pattern-none" };
  const catalogItems = (customize.data?.items ?? []) as Cosmetic[];
  const openedItems = catalogItems.filter((item) => item.opened).map((item) => ({ slug: item.slug, displayName: item.displayName, value: item.value }));
  const expItems = catalogItems;
  const togglePin = (id: string) => setPinned((current) => current.includes(id) ? current.filter((value) => value !== id) : current.length >= 3 ? current : [...current, id]);
  const currentGoal = data.weeklyGoal;
  return <div className="content-stack profile-page"><PageHeading eyebrow="ЛИЧНОЕ ПРОСТРАНСТВО" title="Профиль" detail="Твой путь, достижения и вещи, которые ты выбрал(а) сам(а)." />
    <ProfileHero user={view} appearance={appearance} items={openedItems} currentStreak={data.streak.current} bestStreak={data.streak.best} />
    {data.pendingActivityDays?.length > 0 && <p className="soft-footnote pending-activity-note"><Clock3 size={15} /> Дни отправки {formatDayKeys(data.pendingActivityDays)} ждут проверки и пока не считаются подтверждённой серией.</p>}
    <div className="profile-secondary-grid"><GlassCard className="path-card"><div className="section-card-heading"><div><span className="overline">УРОВЕНЬ {view.level}</span><h2>Мой путь</h2></div><a className="round-link" href="/profile/customize#path" aria-label="Открыть уровни"><ArrowRight size={17} /></a></div><LevelPath totalExp={view.totalExp} level={view.level} items={expItems} /></GlassCard>
      <GlassCard className="weekly-goal-card"><div className="section-card-heading"><div><span className="overline">ДОБРОВОЛЬНО · БЕЗ ШТРАФОВ</span><h2>Цель недели</h2></div><span className="goal-orb"><Compass size={18} /></span></div>
        {currentGoal?.enabled ? <><div className="goal-progress-copy"><strong>{currentGoal.confirmed} <span>из {currentGoal.target}</span></strong><small>работ подтверждено</small></div><div className="goal-track"><span style={{ width: `${Math.min(100, currentGoal.confirmed / currentGoal.target * 100)}%` }} /></div>{currentGoal.pending > 0 && <p className="pending-goal"><Clock3 size={15} /> Ещё {currentGoal.pending} на проверке</p>}<div className="goal-controls"><label className="field"><span>Моя цель</span><select value={goal} onChange={(event) => setGoal(event.target.value)}>{[1, 2, 3, 4, 5].map((number) => <option value={number} key={number}>{number} {plural(number, "работа", "работы", "работ")}</option>)}</select></label><GlassButton variant="secondary" onClick={() => saveGoal.mutate(Number(goal))} disabled={saveGoal.isPending}>Сохранить</GlassButton></div><button className="text-button" onClick={() => saveGoal.mutate(null)}>Выключить цель</button></> : <><p className="goal-explainer">Выбери удобную цель на эту неделю. Она не влияет на оценки, срок или награды.</p><div className="goal-controls"><label className="field"><span>Работ за неделю</span><select value={goal} onChange={(event) => setGoal(event.target.value)}>{[1, 2, 3, 4, 5].map((number) => <option value={number} key={number}>{number} {plural(number, "работа", "работы", "работ")}</option>)}</select></label><GlassButton onClick={() => saveGoal.mutate(Number(goal))} disabled={saveGoal.isPending}>Выбрать цель</GlassButton></div></>}
      </GlassCard></div>
    <div className="profile-secondary-grid profile-secondary-bottom"><GlassCard className="achievement-card"><div className="section-card-heading"><div><span className="overline">ТОЛЬКО ДЛЯ ТЕБЯ</span><h2>Личная витрина</h2></div><span className="pin-count">{pinned.length}/3</span></div><p className="soft-text">Закрепи до трёх уже полученных значков. Их никто кроме тебя не увидит.</p>{data.achievements.length ? <div className="achievement-list">{data.achievements.map((item: any) => <button key={item.id} className={`achievement-chip ${pinned.includes(item.id) ? "pinned" : ""}`} onClick={() => togglePin(item.id)} aria-pressed={pinned.includes(item.id)}><span>{item.slug === "creative-task" ? "✦" : item.slug === "three-day-streak" ? "≈" : "○"}</span><span>{item.name}</span>{pinned.includes(item.id) && <Check size={14} />}</button>)}</div> : <EmptyState title="Значки появятся с опытом" detail="Первая работа и другие реальные действия могут открыть личные достижения." />}<div className="achievement-actions"><GlassButton variant="secondary" onClick={() => savePins.mutate(pinned)} disabled={savePins.isPending}>Сохранить витрину</GlassButton><span>{data.achievements.length} получено</span></div></GlassCard>
      <GlassCard className="savings-summary"><div className="section-card-heading"><div><span className="overline">СПИСОК ЖЕЛАНИЙ</span><h2>Коплю на</h2></div><span className="savings-orb"><Heart size={17} /></span></div><SavingsSummary /></GlassCard></div>
    <GlassCard className="history-card"><div className="section-card-heading"><div><span className="overline">ЛИЧНАЯ ИСТОРИЯ</span><h2>Последние события</h2></div><a className="text-link" href="/profile#history">Вся история <ChevronRight size={16} /></a></div><div className="history-grid">{data.submissions.slice(0, 6).map((item: any) => <div className="history-row" key={item.id}><span className={`history-icon status-icon-${item.status.toLowerCase()}`}><FileCheck2 size={17} /></span><span className="history-copy"><strong>{item.title}</strong><small>{item.subject} · {item.submittedAt ? new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" }).format(new Date(item.submittedAt)) : "черновик"}</small></span>{item.grade ? <span className="grade-mark">{item.grade}</span> : <StatusBadge status={item.status} />}</div>)}</div>{data.ledger?.length > 0 && <div className="ledger-preview"><span className="overline">КОШЕЛЁК · ПОСЛЕДНИЕ ОПЕРАЦИИ</span>{data.ledger.slice(0, 3).map((item: any) => <div className="ledger-row" key={item.id}><span>{item.note}</span><strong className={item.amount < 0 ? "minus" : "plus"}>{item.amount > 0 ? "+" : ""}{item.amount} Э</strong></div>)}</div>}</GlassCard>
    <div className="profile-settings-inline"><button className="settings-card-button" onClick={() => document.querySelector<HTMLButtonElement>(".notification-trigger")?.click()}><Settings2 size={18} /><span><strong>Доступность и уведомления</strong><small>Контраст, прозрачность, спокойный режим</small></span><ChevronRight size={16} /></button><span className="private-note"><ShieldCheck size={15} /> Профиль виден только вам.</span></div>
    
  </div>;
}

function SavingsSummary() {
  const query = useQuery({ queryKey: ["market"], queryFn: () => api<any>("/market") });
  if (query.isLoading) return <LoadingState label="Проверяем цель накопления" />;
  if (query.isError) return <p className="soft-text">Цель сейчас не загружается. Попробуйте обновить страницу.</p>;
  const goal = query.data.savingsGoal;
  if (!goal) return <div className="savings-empty"><p>Выбери товар в маркетплейсе как личную цель. Он не резервируется и не покупается автоматически.</p><a className="glass-button button-secondary" href="/market">Открыть маркет <ArrowRight size={16} /></a></div>;
  return <div className="savings-product"><div className={`product-art art-${goal.product.imageKey}`}>{goal.product.imageUrl?.startsWith("/api/market/products/") ? <img src={goal.product.imageUrl} alt={`Фото товара «${goal.product.name}»`} /> : <span className="product-art-icon">{productIcon(goal.product.imageKey)}</span>}</div><div className="savings-product-copy"><div><strong>{goal.product.name}</strong><span>{goal.product.price} Эйнштейнов</span></div><div className="savings-values"><span>Баланс: {goal.balance}</span><span>{goal.remaining === 0 ? "Уже хватает" : `Осталось ${goal.remaining}`}</span></div><div className="goal-track"><span style={{ width: `${goal.progress}%` }} /></div>{!goal.product.active || goal.product.stock <= 0 ? <small className="unavailable-label">Сейчас недоступно · цель можно сменить в маркете</small> : <a className="text-link" href="/market">Перейти к товару <ChevronRight size={15} /></a>}</div></div>;
}

function CustomizePage({ user, toast }: { user: NonNullable<SessionResponse["user"]>; toast: ToastHook }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["customize"], queryFn: () => api<any>("/profile/customize") });
  const [draft, setDraft] = useState<AppearanceView | null>(null);
  const [category, setCategory] = useState("ALL");
  const [filter, setFilter] = useState("ALL");
  const [showAllLevels, setShowAllLevels] = useState(false);
  const [kitMessage, setKitMessage] = useState("");
  useEffect(() => { if (draft === null && query.data?.appearance) setDraft(query.data.appearance); }, [draft, query.data?.appearance]);
  const catalog = (query.data?.items ?? []) as Cosmetic[];
  const saved = query.data?.appearance as AppearanceView | undefined;
  const categories = [{ id: "ALL", label: "Все" }, { id: "PROFILE_BACKGROUND", label: "Фоны" }, { id: "NICK_EMOJI", label: "Эмодзи" }, { id: "AVATAR_FRAME", label: "Рамка аватара" }, { id: "PROFILE_TITLE", label: "Подписи" }, { id: "PROFILE_PATTERN", label: "Узоры" }];
  const current = draft ?? saved ?? { background: "pearl", emoji: "emoji-none", frame: "frame-none", title: "title-none", pattern: "pattern-none" };
  const fieldByType: Record<string, keyof AppearanceView> = { PROFILE_BACKGROUND: "background", NICK_EMOJI: "emoji", AVATAR_FRAME: "frame", PROFILE_TITLE: "title", PROFILE_PATTERN: "pattern" };
  const visible = catalog.filter((item) => (category === "ALL" || item.type === category) && (filter === "ALL" || (filter === "OPEN" ? item.opened : !item.opened)));
  const hasChanges = saved && Object.keys(current).some((key) => current[key as keyof AppearanceView] !== saved[key as keyof AppearanceView]);
  const valid = (Object.entries(current) as Array<[keyof AppearanceView, string]>).every(([key, slug]) => catalog.some((item) => item.slug === slug && item.opened && fieldByType[item.type] === key));
  const apply = useMutation({ mutationFn: (appearance: AppearanceView) => api<any>("/profile/appearance", { method: "PUT", body: jsonBody(appearance) }), onSuccess: (data) => { setDraft(data.appearance); void client.invalidateQueries({ queryKey: ["session"] }); void client.invalidateQueries({ queryKey: ["profile"] }); void client.invalidateQueries({ queryKey: ["customize"] }); toast.show("Оформление сохранено"); setKitMessage(""); }, onError: (error: Error) => { setKitMessage(error.message); toast.show(error.message); } });
  const reset = useMutation({ mutationFn: () => api<any>("/profile/appearance/reset", { method: "POST" }), onSuccess: (data) => { setDraft(data.appearance); void client.invalidateQueries({ queryKey: ["session"] }); void client.invalidateQueries({ queryKey: ["profile"] }); void client.invalidateQueries({ queryKey: ["customize"] }); toast.show("Базовое оформление применено"); }, onError: (error: Error) => toast.show(error.message) });
  if (query.isLoading) return <LoadingState label="Загружаем твою коллекцию" />;
  if (query.isError) return <ErrorState detail={(query.error as Error).message} retry={() => void query.refetch()} />;
  const previewUser = { ...user, level: query.data.level, totalExp: query.data.totalExp } as UserView;
  const selected = (item: Cosmetic) => {
    const key = fieldByType[item.type]; if (!key) return;
    setDraft((state) => ({ ...(state ?? saved ?? current), [key]: item.slug }));
    setKitMessage(item.opened ? "" : "Предпросмотр — предмет пока закрыт. Нажми «Отменить изменения», чтобы вернуться к сохранённому виду.");
  };
  const applyKit = () => {
    const partSlugs = ["bg-cosmic-mist", "frame-rings", "emoji-satellite", "title-traveler", "pattern-stardust"];
    const parts = partSlugs.map((slug) => catalog.find((item) => item.slug === slug));
    if (parts.some((item) => !item?.opened)) { setKitMessage("Комплект «Космос» откроется целиком на уровне 10."); return; }
    setDraft({ background: partSlugs[0]!, frame: partSlugs[1]!, emoji: partSlugs[2]!, title: partSlugs[3]!, pattern: partSlugs[4]! });
    setKitMessage("Комплект собран в предпросмотре. Он сохранится после нажатия «Применить».");
  };
  return <div className="content-stack customize-page"><PageHeading eyebrow="ЛИЧНОЕ ПРОСТРАНСТВО" title="Оформление" detail="Выбирай вид профиля для себя. Открытия не влияют на оценки, деньги и роли." action={<a href="/profile" className="glass-button button-quiet"><ChevronRight size={16} className="back-chevron" /> Профиль</a>} />
    <GlassCard className="customize-progress-card"><div className="customize-level-copy"><span className="level-orbit">{query.data.level}</span><div><span className="overline">ТВОЙ ТЕКУЩИЙ УРОВЕНЬ</span><h2>{query.data.totalExp} EXP <span>за подтверждённые работы</span></h2></div></div><ExpBar totalExp={query.data.totalExp} level={query.data.level} /><span className="unlock-count">{catalog.filter((item) => item.opened).length} открыто из {catalog.length}</span></GlassCard>
    <div className="customize-layout"><div className="customize-catalog"><GlassCard className="catalog-panel"><div className="section-card-heading"><div><span className="overline">КОЛЛЕКЦИЯ</span><h2>Выбери деталь</h2></div><button className="text-button" onClick={applyKit}>Комплект «Космос»</button></div>
      <div className="catalog-toolbar"><div className="category-scroll" role="tablist" aria-label="Категории оформления">{categories.map((item) => <button key={item.id} role="tab" aria-selected={category === item.id} className={`category-tab ${category === item.id ? "active" : ""}`} onClick={() => setCategory(item.id)}>{item.label}</button>)}</div><select aria-label="Фильтр открытий" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="ALL">Все предметы</option><option value="OPEN">Открытые</option><option value="LOCKED">Ещё не открыты</option></select></div>
      <div className="cosmetic-grid">{visible.map((item) => item.type === "AVATAR_FRAME" ? <FrameCosmeticCard key={item.id} item={item} isDraftSelected={current.frame === item.slug} onPreview={selected} onApply={(frame) => { if (valid) apply.mutate({ ...current, frame: frame.slug }); }} canApply={valid && !apply.isPending} /> : <CosmeticCard key={item.id} item={item} isDraftSelected={current[fieldByType[item.type]!] === item.slug} onSelect={selected} />)}</div>
      {visible.length === 0 && <EmptyState title="В этой категории пока нет предметов" detail="Сбросьте фильтр, чтобы снова увидеть коллекцию." />}
      {kitMessage && <p className="kit-message" role="status">{kitMessage}</p>}
      <div className="customize-actions"><button className="text-button" onClick={() => { setDraft(saved ?? null); setKitMessage(""); }}>Отменить изменения</button><button className="text-button" onClick={() => reset.mutate()} disabled={reset.isPending}>Сбросить к базовому</button><GlassButton onClick={() => apply.mutate(current)} disabled={!hasChanges || !valid || apply.isPending}>{apply.isPending ? "Сохраняем…" : "Сохранить изменения"}<Check size={16} /></GlassButton></div>
      {!valid && <p className="validation-note">В предпросмотре есть закрытый предмет. Его можно посмотреть, но применить получится после открытия.</p>}
    </GlassCard>
    <GlassCard className="level-path-card" id="path"><div className="section-card-heading"><div><span className="overline">БЕЗ РЕЙТИНГОВ И СПЕШКИ</span><h2>Мой путь</h2></div><button className="text-button" onClick={() => setShowAllLevels((value) => !value)}>{showAllLevels ? "Свернуть" : "Все уровни"}<ChevronDown size={15} /></button></div><LevelPath totalExp={query.data.totalExp} level={query.data.level} items={catalog} showAll={showAllLevels} /></GlassCard>
    </div><aside className="customize-preview-column"><div className="sticky-preview"><span className="overline">ТАК ВЫГЛЯДИТ ТВОЙ ПРОФИЛЬ</span><ProfilePreview user={previewUser} appearance={current} items={catalog} preview={Boolean(hasChanges)} /><GlassCard className="preview-explainer"><span className="preview-key"><span className="preview-key-dot" /> Предпросмотр</span><p>Примерка меняет только этот экран. Чтобы сохранить, нажми «Сохранить изменения».</p></GlassCard><div className="accessibility-shortcut"><ShieldCheck size={17} /><span>Контраст, движение и прозрачность меняются в настройках и не требуют EXP.</span><button onClick={() => document.querySelector<HTMLButtonElement>(".notification-trigger")?.click()}>Настройки</button></div></div></aside></div>
  </div>;
}

type AboutMemberView = { id: string; name: string; role: string; description: string; imageAttachmentId: string | null; imageUrl: string | null; isVisible: boolean };
type AboutSectionView = { id: string; title: string; body: string; imageAttachmentId: string | null; imageUrl: string | null; isVisible: boolean };
type AboutView = { id: string; title: string; description: string; updatedAt: string; teamMembers: AboutMemberView[]; sections: AboutSectionView[] };
const emptyAbout: AboutView = { id: "main", title: "О Вайбе", description: "", updatedAt: "", teamMembers: [], sections: [] };

function reorder<T>(items: T[], index: number, delta: number) {
  const next = [...items];
  const target = index + delta;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

function AboutPage({ user, toast }: { user: NonNullable<SessionResponse["user"]>; toast: ToastHook }) {
  const client = useQueryClient();
  const owner = user.role === "PROJECT_OWNER";
  const query = useQuery({ queryKey: ["about"], queryFn: () => api<AboutView>("/about") });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<AboutView>(emptyAbout);
  const [createdImages, setCreatedImages] = useState<string[]>([]);
  const [uploadsPending, setUploadsPending] = useState(0);
  const saveInFlight = useRef(false);
  useEffect(() => { if (query.data && !editing) setDraft(query.data); }, [query.data, editing]);
  const save = useMutation({
    mutationFn: (value: AboutView) => api<AboutView>("/owner/about", { method: "PUT", body: jsonBody({
      title: value.title, description: value.description,
      teamMembers: value.teamMembers.map(({ name, role, description, imageAttachmentId, isVisible }) => ({ name, role, description, imageAttachmentId, isVisible })),
      sections: value.sections.map(({ title, body, imageAttachmentId, isVisible }) => ({ title, body, imageAttachmentId, isVisible })),
    }) }),
    onSuccess: (value) => { setDraft(value); setEditing(false); setCreatedImages([]); client.setQueryData(["about"], value); void client.invalidateQueries({ queryKey: ["about"] }); toast.show("Страница «О нас» сохранена"); },
    onError: (error: Error) => toast.show(error.message),
    onSettled: () => { saveInFlight.current = false; },
  });
  const savePage = () => {
    if (saveInFlight.current || uploadsPending > 0) return;
    saveInFlight.current = true;
    save.mutate(draft);
  };
  const edit = () => { setDraft(query.data ?? emptyAbout); setEditing(true); };
  const cancel = () => {
    if (uploadsPending) return;
    for (const id of createdImages) void api(`/owner/about/images/${id}`, { method: "DELETE" }).catch(() => undefined);
    setCreatedImages([]); setDraft(query.data ?? emptyAbout); setEditing(false);
  };
  const upload = async (file: File, target: { kind: "member" | "section"; id: string }) => {
    if (!file.type.startsWith("image/")) { toast.show("Выберите JPEG, PNG или WebP изображение"); return; }
    setUploadsPending((count) => count + 1);
    const form = new FormData(); form.append("image", file);
    try {
      const result = await api<{ id: string; url: string }>("/owner/about/images", { method: "POST", body: form });
      setCreatedImages((ids) => [...ids, result.id]);
      setDraft((value) => target.kind === "member"
        ? ({ ...value, teamMembers: value.teamMembers.map((item) => item.id === target.id ? { ...item, imageAttachmentId: result.id, imageUrl: result.url } : item) })
        : ({ ...value, sections: value.sections.map((item) => item.id === target.id ? { ...item, imageAttachmentId: result.id, imageUrl: result.url } : item) }));
      toast.show("Фото загружено. Оно сохранится вместе со страницей.");
    } catch (error) { toast.show((error as Error).message); }
    finally { setUploadsPending((count) => Math.max(0, count - 1)); }
  };
  if (query.isLoading) return <LoadingState label="Загружаем страницу проекта" />;
  if (query.isError) return <ErrorState detail={(query.error as Error).message} retry={() => void query.refetch()} />;
  const visibleMembers = draft.teamMembers.filter((item) => editing || item.isVisible);
  const visibleSections = draft.sections.filter((item) => editing || item.isVisible);
  return <div className="content-stack about-page">
    <PageHeading eyebrow="КОМАНДА И ИДЕЯ" title={editing ? "Редактирование страницы" : draft.title} detail={editing ? "Изменения увидят все авторизованные участники после сохранения." : undefined} action={owner ? editing ? <div className="about-page-actions"><GlassButton variant="secondary" onClick={cancel} disabled={save.isPending || uploadsPending > 0}>Отменить</GlassButton><GlassButton onClick={savePage} disabled={save.isPending || uploadsPending > 0}>{uploadsPending ? "Загружаем фото…" : save.isPending ? "Сохраняем…" : "Сохранить страницу"}<Check size={16} /></GlassButton></div> : <GlassButton onClick={edit}>Редактировать страницу</GlassButton> : undefined} />
    {editing && <GlassCard className="about-edit-hero"><label className="field"><span>Заголовок</span><input maxLength={120} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} /></label><label className="field"><span>Краткое описание проекта</span><textarea maxLength={8000} rows={6} value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} /></label><small>Текст отображается без HTML-разметки и ограничен 8 000 символами.</small></GlassCard>}
    <GlassCard className="about-hero"><span className="about-hero-glow" /><span className="overline">ШКОЛЬНАЯ ЖИЗНЬ ИНТЕРЕСНЕЕ</span>{!editing && <h2>{draft.title}</h2>}<p>{draft.description || "Описание проекта пока не заполнено."}</p><div className="about-mission-points"><span><b>01</b> личный прогресс</span><span><b>02</b> любознательность и старание</span><span><b>03</b> поддержка учителя</span></div></GlassCard>
    {(visibleSections.length > 0 || editing) && <section className="about-sections"><div className="section-card-heading"><div><span className="overline">ИДЕЯ И ПРОЕКТ</span><h2>О Вайбе</h2></div>{editing && <GlassButton variant="secondary" onClick={() => setDraft((value) => ({ ...value, sections: [...value.sections, { id: crypto.randomUUID(), title: "", body: "", imageAttachmentId: null, imageUrl: null, isVisible: true }] }))}><Plus size={16} /> Добавить блок</GlassButton>}</div>{visibleSections.length ? <div className="about-section-list">{visibleSections.map((section) => { const index = draft.sections.indexOf(section); return <GlassCard className="about-section-card" key={section.id}>{editing ? <><div className="about-edit-row"><label className="field"><span>Заголовок блока</span><input maxLength={160} value={section.title} onChange={(event) => setDraft((value) => ({ ...value, sections: value.sections.map((item, i) => i === index ? { ...item, title: event.target.value } : item) }))} /></label><div className="about-order-actions"><button className="icon-button" aria-label="Поднять блок" onClick={() => setDraft((value) => ({ ...value, sections: reorder(value.sections, index, -1) }))}><ArrowUp size={17} /></button><button className="icon-button" aria-label="Опустить блок" onClick={() => setDraft((value) => ({ ...value, sections: reorder(value.sections, index, 1) }))}><ArrowDown size={17} /></button><button className="icon-button about-delete" aria-label="Удалить блок" onClick={() => setDraft((value) => ({ ...value, sections: value.sections.filter((_, i) => i !== index) }))}><Trash2 size={17} /></button></div></div><label className="field"><span>Текст</span><textarea rows={5} maxLength={8000} value={section.body} onChange={(event) => setDraft((value) => ({ ...value, sections: value.sections.map((item, i) => i === index ? { ...item, body: event.target.value } : item) }))} /></label><AboutImageEditor imageUrl={section.imageUrl} onRemove={() => setDraft((value) => ({ ...value, sections: value.sections.map((item, i) => i === index ? { ...item, imageAttachmentId: null, imageUrl: null } : item) }))} onUpload={(file) => void upload(file, { kind: "section", id: section.id })} /><label className="about-visible-toggle"><input type="checkbox" checked={section.isVisible} onChange={(event) => setDraft((value) => ({ ...value, sections: value.sections.map((item, i) => i === index ? { ...item, isVisible: event.target.checked } : item) }))} /> Показывать блок на странице</label></> : <><h3>{section.title}</h3><p>{section.body}</p>{section.imageUrl && <img className="about-section-image" src={section.imageUrl} alt={section.title} />}</>}</GlassCard>; })}</div> : !editing && null}</section>}
    {(visibleMembers.length > 0 || editing) && <section className="about-team"><div className="section-card-heading"><div><span className="overline">ЛЮДИ ЗА ПРОЕКТОМ</span><h2>Команда</h2></div>{editing && <GlassButton variant="secondary" onClick={() => setDraft((value) => ({ ...value, teamMembers: [...value.teamMembers, { id: crypto.randomUUID(), name: "", role: "", description: "", imageAttachmentId: null, imageUrl: null, isVisible: true }] }))}><Plus size={16} /> Добавить участника</GlassButton>}</div>{visibleMembers.length ? <div className="about-team-grid">{visibleMembers.map((member) => { const index = draft.teamMembers.indexOf(member); return <GlassCard className="about-member-card" key={member.id}>{editing ? <><div className="about-member-edit-heading"><AboutImageEditor compact imageUrl={member.imageUrl} onRemove={() => setDraft((value) => ({ ...value, teamMembers: value.teamMembers.map((item, i) => i === index ? { ...item, imageAttachmentId: null, imageUrl: null } : item) }))} onUpload={(file) => void upload(file, { kind: "member", id: member.id })} /><div className="about-order-actions"><button className="icon-button" aria-label="Поднять участника" onClick={() => setDraft((value) => ({ ...value, teamMembers: reorder(value.teamMembers, index, -1) }))}><ArrowUp size={17} /></button><button className="icon-button" aria-label="Опустить участника" onClick={() => setDraft((value) => ({ ...value, teamMembers: reorder(value.teamMembers, index, 1) }))}><ArrowDown size={17} /></button><button className="icon-button about-delete" aria-label="Удалить участника" onClick={() => setDraft((value) => ({ ...value, teamMembers: value.teamMembers.filter((_, i) => i !== index) }))}><Trash2 size={17} /></button></div></div><label className="field"><span>Имя</span><input maxLength={100} value={member.name} onChange={(event) => setDraft((value) => ({ ...value, teamMembers: value.teamMembers.map((item, i) => i === index ? { ...item, name: event.target.value } : item) }))} /></label><label className="field"><span>Роль</span><input maxLength={120} value={member.role} onChange={(event) => setDraft((value) => ({ ...value, teamMembers: value.teamMembers.map((item, i) => i === index ? { ...item, role: event.target.value } : item) }))} /></label><label className="field"><span>Короткое описание</span><textarea rows={3} maxLength={1000} value={member.description} onChange={(event) => setDraft((value) => ({ ...value, teamMembers: value.teamMembers.map((item, i) => i === index ? { ...item, description: event.target.value } : item) }))} /></label><label className="about-visible-toggle"><input type="checkbox" checked={member.isVisible} onChange={(event) => setDraft((value) => ({ ...value, teamMembers: value.teamMembers.map((item, i) => i === index ? { ...item, isVisible: event.target.checked } : item) }))} /> Показывать участника</label></> : <><div className="about-member-photo">{member.imageUrl ? <img src={member.imageUrl} alt={member.name} /> : <span>{member.name.slice(0, 1).toLocaleUpperCase("ru-RU")}</span>}</div><h3>{member.name}</h3><strong>{member.role}</strong><p>{member.description}</p></>}</GlassCard>; })}</div> : <EmptyState title="Команда пока не добавлена" detail="Здесь появятся участники, когда владелец проекта заполнит карточки." />}</section>}
  </div>;
}

function AboutImageEditor({ imageUrl, onRemove, onUpload, compact = false }: { imageUrl: string | null; onRemove: () => void; onUpload: (file: File) => void; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  return <div className={`about-image-editor ${compact ? "is-compact" : ""}`}>
    {imageUrl ? <img src={imageUrl} alt="Предпросмотр загруженного изображения" /> : <span className="about-image-placeholder"><ImagePlus size={22} />Фото не добавлено</span>}
    <div><button type="button" className="glass-button button-secondary" onClick={() => inputRef.current?.click()}><ImagePlus size={16} />{imageUrl ? "Заменить фото" : "Загрузить фото"}</button>{imageUrl && <button type="button" className="text-button danger-text" onClick={onRemove}>Убрать фото</button>}<input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" aria-label="Загрузить JPEG, PNG или WebP" onChange={(event) => { const file = event.target.files?.[0]; if (file) onUpload(file); event.currentTarget.value = ""; }} /></div>
    {!compact && <small>JPEG, PNG или WebP · до 10 МБ</small>}
  </div>;
}

function MarketPage({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["market"], queryFn: () => api<any>("/market") });
  const [marketTab, setMarketTab] = useState("GLOBAL");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [marketCategory, setMarketCategory] = useState("ALL");
  const [confirmProduct, setConfirmProduct] = useState<any>(null);
  const [detailsProduct, setDetailsProduct] = useState<any>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const mutation = useMutation({ mutationFn: (body: unknown) => api<any>("/market/favorites", { method: "PUT", body: jsonBody(body) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["market"] }); toast.show("Список желаний обновлён"); }, onError: (error: Error) => toast.show(error.message) });
  const setSavings = useMutation({ mutationFn: (productId: string | null) => api("/market/savings-goal", { method: "PUT", body: jsonBody({ productId }) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["market"] }); toast.show("Цель накопления сохранена"); }, onError: (error: Error) => toast.show(error.message) });
  const buy = useMutation({ mutationFn: (productId: string) => api<any>("/market/purchase", { method: "POST", body: jsonBody({ productId, idempotencyKey: crypto.randomUUID() }) }), onSuccess: (data) => { setConfirmProduct(null); toast.show(`Заказ создан · код ${data.order.code}`); void client.invalidateQueries({ queryKey: ["market"] }); void client.invalidateQueries({ queryKey: ["session"] }); void client.invalidateQueries({ queryKey: ["profile"] }); }, onError: (error: Error) => { setConfirmProduct(null); toast.show(error.message); } });
  if (query.isLoading) return <LoadingState label="Загружаем каталог" />;
  if (query.isError) return <ErrorState detail={(query.error as Error).message} retry={() => void query.refetch()} />;
  const all = query.data.products as any[];
  const categories = [...new Set(all.filter((product) => product.active !== false && product.scope === marketTab).map((product) => product.category as string))].sort((left, right) => left.localeCompare(right, "ru-RU"));
  const items = all.filter((product) => product.active !== false && product.scope === marketTab && (marketCategory === "ALL" || product.category === marketCategory) && (!favoriteOnly || product.favorite) && `${product.name} ${product.category}`.toLocaleLowerCase("ru-RU").includes(search.toLocaleLowerCase("ru-RU")));
  return <div className="content-stack market-page"><PageHeading eyebrow="ШКОЛЬНЫЕ НАГРАДЫ" title="Маркетплейс" detail="Список желаний помогает выбрать цель. Товар и валюта не резервируются до покупки." action={<BalanceBadge balance={query.data.balance} />} />
    <div className="market-intro-row"><div className="market-tabs" role="tablist"><button role="tab" aria-selected={marketTab === "GLOBAL"} className={marketTab === "GLOBAL" ? "active" : ""} onClick={() => { setMarketTab("GLOBAL"); setMarketCategory("ALL"); setFavoriteOnly(false); }}>Маркет Вайба</button><button role="tab" aria-selected={marketTab === "SCHOOL"} className={marketTab === "SCHOOL" ? "active" : ""} onClick={() => { setMarketTab("SCHOOL"); setMarketCategory("ALL"); setFavoriteOnly(false); }}>Школьный маркет</button></div><label className="favorite-toggle"><input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} /><Heart size={16} /> Избранное</label></div>
    <div className="filter-scroll market-category-filter" role="tablist" aria-label="Категории наград"><button type="button" role="tab" aria-selected={marketCategory === "ALL"} className={`filter-chip ${marketCategory === "ALL" ? "active" : ""}`} onClick={() => setMarketCategory("ALL")}>Все категории</button>{categories.map((item) => <button type="button" role="tab" aria-selected={marketCategory === item} className={`filter-chip ${marketCategory === item ? "active" : ""}`} key={item} onClick={() => setMarketCategory(item)}>{item}</button>)}</div>
    <div className="market-toolbar"><div><h2>{marketTab === "GLOBAL" ? "Тёплые мелочи от Вайба" : "Награды твоей школы"}</h2><p>{marketTab === "GLOBAL" ? "Покупка за личные Эйнштейны" : "Условия и выдачу подтверждают сотрудники школы"}</p></div><label className="search-box"><Search size={17} /><input ref={searchRef} aria-label="Поиск товаров" placeholder="Найти награду" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button type="button" className="search-clear" aria-label="Очистить поиск товаров" onClick={() => { setSearch(""); searchRef.current?.focus(); }}><X size={17} /></button>}</label></div>
    {!items.length ? <EmptyState title="Товаров не найдено" detail={favoriteOnly ? "В этом разделе пока нет избранного." : "Попробуйте изменить запрос."} /> : <div className="market-grid">{items.map((product) => <GlassCard key={product.id} className="product-card"><div className={`product-art art-${product.imageKey}`}>{product.imageUrl?.startsWith("/api/market/products/") ? <img src={product.imageUrl} alt={`Фото товара «${product.name}»`} /> : <span className="product-art-icon">{productIcon(product.imageKey)}</span>}<button className={`favorite-button ${product.favorite ? "is-favorite" : ""}`} aria-label={product.favorite ? "Убрать из избранного" : "Добавить в избранное"} aria-pressed={product.favorite} onClick={() => mutation.mutate({ productId: product.id, favorite: !product.favorite })}><Heart size={18} fill={product.favorite ? "currentColor" : "none"} /></button>{!product.imageUrl?.startsWith("/api/market/products/") && <span className="product-art-shine" />}</div><div className="product-details"><div className="product-category">{product.category}<span>{product.scope === "GLOBAL" ? "Вайб" : "Твоя школа"}</span></div><h3>{product.name}</h3><p className="product-summary">{product.description}</p><button type="button" className="product-more-link" onClick={() => setDetailsProduct(product)}>Подробнее</button><div className="product-availability"><span className={product.available ? "stock-dot" : "stock-dot is-empty"} />{product.available ? `Осталось ${product.stock}` : "Сейчас недоступно"}</div><div className="product-actions"><strong>{product.price} <small>Э</small></strong><div className="product-action-buttons"><GlassButton variant="quiet" onClick={() => setSavings.mutate(query.data.savingsGoal?.product?.id === product.id ? null : product.id)}>{query.data.savingsGoal?.product?.id === product.id ? "Убрать цель" : "Копить на это"}</GlassButton><GlassButton onClick={() => setConfirmProduct(product)} disabled={!product.available || query.data.balance < product.price || query.data.membershipRole !== "STUDENT"}>Выбрать</GlassButton></div></div>{query.data.balance < product.price && product.scope === "GLOBAL" && <small className="need-more">До покупки не хватает {product.price - query.data.balance} Эйнштейнов</small>}</div></GlassCard>)}</div>}
    {query.data.orders?.length > 0 && <GlassCard className="orders-panel"><div className="section-card-heading"><div><span className="overline">МОИ ПОКУПКИ</span><h2>Заказы</h2></div><PackageCheck size={19} /></div><div className="orders-list">{query.data.orders.map((order: any) => <div className="order-row" key={order.id}><span className={`order-art art-${order.imageKey}`}>{productIcon(order.imageKey)}</span><div><strong>{order.name}</strong><small>Код получения: <b>{order.code}</b></small></div><StatusBadge status={order.status} />{order.status === "RESERVED" && <button className="text-button danger-text" onClick={() => void api(`/market/orders/${order.id}/cancel`, { method: "POST" }).then(() => { toast.show("Заказ отменён, Эйнштейны возвращены"); void client.invalidateQueries({ queryKey: ["market"] }); void client.invalidateQueries({ queryKey: ["session"] }); }).catch((error: Error) => toast.show(error.message))}>Отменить</button>}</div>)}</div></GlassCard>}
    <GlassModal open={Boolean(detailsProduct)} title={detailsProduct?.name ?? "Награда"} onClose={() => setDetailsProduct(null)}>{detailsProduct && <div className="product-detail-modal"><div className="product-art">{detailsProduct.imageUrl?.startsWith("/api/market/products/") ? <img src={detailsProduct.imageUrl} alt="Фото товара" /> : <span className="product-art-icon">{productIcon(detailsProduct.imageKey)}</span>}</div><div className="product-detail-copy"><div className="product-category">{detailsProduct.category}<span>{detailsProduct.scope === "GLOBAL" ? "Вайб" : "Твоя школа"}</span></div><p>{detailsProduct.description}</p><div className="purchase-total"><span>Стоимость</span><strong>{detailsProduct.price} Эйнштейнов</strong></div><div className="purchase-total"><span>Наличие</span><strong>{detailsProduct.available ? "Осталось " + detailsProduct.stock : "Сейчас недоступно"}</strong></div>{detailsProduct.perUserLimit > 1 && <small>Можно выбрать до {detailsProduct.perUserLimit} раз на одного участника.</small>}<div className="modal-actions"><GlassButton variant="secondary" onClick={() => setDetailsProduct(null)}>Закрыть</GlassButton><GlassButton onClick={() => { setConfirmProduct(detailsProduct); setDetailsProduct(null); }} disabled={!detailsProduct.available || query.data.balance < detailsProduct.price || query.data.membershipRole !== "STUDENT"}>Выбрать</GlassButton></div></div></div>}</GlassModal>    <GlassModal open={Boolean(confirmProduct)} title="Подтвердить покупку" onClose={() => setConfirmProduct(null)}>{confirmProduct && <div className="purchase-confirm"><div className={`product-art art-${confirmProduct.imageKey}`}><span className="product-art-icon">{productIcon(confirmProduct.imageKey)}</span></div><h3>{confirmProduct.name}</h3><p>{confirmProduct.description}</p><div className="purchase-total"><span>Стоимость</span><strong>{confirmProduct.price} Эйнштейнов</strong></div><div className="purchase-total"><span>Остаток после покупки</span><strong>{query.data.balance - confirmProduct.price} Эйнштейнов</strong></div><div className="modal-actions"><GlassButton variant="secondary" onClick={() => setConfirmProduct(null)}>Вернуться</GlassButton><GlassButton onClick={() => buy.mutate(confirmProduct.id)} disabled={buy.isPending}>{buy.isPending ? "Покупаем…" : "Подтвердить покупку"}</GlassButton></div></div>}</GlassModal>
    
  </div>;
}

function TeacherPage({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const assignments = useQuery({ queryKey: ["teacher-assignments"], queryFn: () => api<any[]>("/teacher/assignments") });
  const submissions = useQuery({ queryKey: ["teacher-submissions"], queryFn: () => api<any[]>("/teacher/submissions") });
  const stats = useQuery({ queryKey: ["teacher-stats"], queryFn: () => api<any>("/teacher/stats") });
  const [editingOwnClasses, setEditingOwnClasses] = useState(false);
  const [tab, setTab] = useState("queue");
  const [showCreator, setShowCreator] = useState(false);
  const [removeAssignment, setRemoveAssignment] = useState<{ id: string; title: string } | null>(null);
  const [createError, setCreateError] = useState("");
  const [review, setReview] = useState<any>(null);
  const [scores, setScores] = useState<Record<string, string>>({});
  const [comment, setComment] = useState("");
  const allError = assignments.isError || submissions.isError || stats.isError;
  const create = useMutation({ mutationFn: ({ data, publish }: { data: unknown; publish: boolean }) => api<any>("/teacher/assignments", { method: "POST", body: jsonBody({ ...(data as object), publish }) }), onSuccess: (result) => { setCreateError(""); setShowCreator(false); toast.show(result.status === "PUBLISHED" ? "Работа опубликована для выбранных классов" : "Черновик сохранён"); void client.invalidateQueries({ queryKey: ["teacher-assignments"] }); void client.invalidateQueries({ queryKey: ["tasks"] }); }, onError: (error: Error) => setCreateError(assignmentCreationHelp(error)) });
  const removeTask = useMutation({ mutationFn: (id: string) => api(`/teacher/assignments/${encodeURIComponent(id)}`, { method: "DELETE" }), onSuccess: () => { setRemoveAssignment(null); toast.show("Задание удалено"); void client.invalidateQueries({ queryKey: ["teacher-assignments"] }); void client.invalidateQueries({ queryKey: ["teacher-stats"] }); void client.invalidateQueries({ queryKey: ["tasks"] }); }, onError: (error: Error) => toast.show(error.message) });
  const saveReview = useMutation({ mutationFn: (body: unknown) => api<any>(`/teacher/submissions/${review?.id}/review`, { method: "POST", body: jsonBody(body) }), onSuccess: (data) => { setReview(null); toast.show(data.reward?.note ? `Проверено · ${data.reward.note}` : data.rewardGranted ? `Проверено · оценка ${data.grade}, награда уже учтена` : "Работа отправлена на доработку"); void client.invalidateQueries({ queryKey: ["teacher-submissions"] }); void client.invalidateQueries({ queryKey: ["teacher-stats"] }); }, onError: (error: Error) => toast.show(error.message) });
  if (assignments.isLoading || submissions.isLoading || stats.isLoading) return <LoadingState label="Открываем кабинет учителя" />;
  if (allError) return <ErrorState title="Кабинет недоступен" detail={(assignments.error ?? submissions.error ?? stats.error as Error).message} retry={() => { void assignments.refetch(); void submissions.refetch(); void stats.refetch(); }} />;
  const pending = submissions.data!.filter((item) => item.status === "SUBMITTED");
  const gradeChart = Object.entries(stats.data!.grades).map(([grade, count]) => ({ name: `${grade}`, value: count }));
  return <div className="content-stack teacher-page"><PageHeading eyebrow="РАБОЧЕЕ ПРОСТРАНСТВО УЧИТЕЛЯ" title="Кабинет учителя" detail="Работы, проверка и агрегированная статистика по закреплённым классам." action={<GlassButton onClick={() => { setCreateError(""); setShowCreator(true); }}><Plus size={17} /> Создать работу</GlassButton>} />
    <div><GlassButton variant="secondary" onClick={() => setEditingOwnClasses(true)}>Выбрать мои классы</GlassButton></div>
    {editingOwnClasses && <OwnTeacherClassEditor toast={toast} onClose={() => setEditingOwnClasses(false)} />}
    <div className="teacher-tabs" role="tablist">{[{ id: "queue", label: "На проверке", count: pending.length }, { id: "assignments", label: "Мои задания", count: assignments.data!.length }, { id: "stats", label: "Статистика", count: null }].map((item) => <button key={item.id} role="tab" aria-selected={tab === item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}>{item.label}{item.count !== null && <span>{item.count}</span>}</button>)}</div>
    {tab === "queue" && <>{!pending.length ? <EmptyState title="Очередь свободна" detail="Новые работы появятся после сдачи смешанных и развёрнутых заданий." /> : <div className="review-queue">{pending.map((row) => <GlassCard className="review-card" key={row.id}><div className="review-card-top"><div><span className="task-category">{row.student.className} · {row.assignment.category}</span><h2>{row.assignment.title}</h2><p>{row.student.name} · отправлено {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.submittedAt))}</p></div><StatusBadge status={row.status} /></div><div className="review-answer-preview">{row.answers.map((answer: any) => <div key={answer.question.id}><small>{answer.question.prompt}</small><p>{answer.text || "Фото/текст решения"}</p>{answer.uploads.map((file: any) => <a key={file.id} href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt="Фото решения ученика" /></a>)}</div>)}</div><GlassButton variant="secondary" onClick={() => { setReview(row); setScores(Object.fromEntries(row.answers.map((answer: any) => [answer.question.id, String(answer.earnedPoints ?? "")]))); setComment(""); }}>Проверить работу <ArrowRight size={16} /></GlassButton></GlassCard>)}</div>}</>}
    {tab === "assignments" && <>{!assignments.data!.length ? <EmptyState title="Создай первую работу" detail="Быстрые ответы проверяются автоматически, развёрнутые — остаются тебе." action={<GlassButton onClick={() => setShowCreator(true)}>Создать работу</GlassButton>} /> : <div className="teacher-assignment-list">{assignments.data!.map((row: any) => <GlassCard className="teacher-assignment-row" key={row.id}><span className="teacher-assignment-icon"><BookOpen size={19} /></span><div><span className="task-category">{row.category} · {row.subject}</span><h3>{row.title}</h3><small>{row.classes.join(", ")} · {row.recipients} назначено · {row.submissions} сдач</small></div><div className="teacher-assignment-actions"><StatusBadge status={row.published ? "PUBLISHED" : "DRAFT"} /><button type="button" className="text-button danger-text" aria-label={`Удалить задание ${row.title}`} onClick={() => setRemoveAssignment({ id: row.id, title: row.title })}>Удалить</button></div></GlassCard>)}</div>}</>}
    {tab === "stats" && <div className="stats-grid"><GlassCard className="teacher-stat-card"><span className="overline">ЗА ВСЁ ВРЕМЯ</span><strong>{stats.data!.assignments}</strong><small>работ создано</small></GlassCard><GlassCard className="teacher-stat-card"><span className="overline">СДАЧИ</span><strong>{stats.data!.submissions}</strong><small>{stats.data!.pending} ожидают проверки</small></GlassCard><GlassCard className="chart-card"><div className="section-card-heading"><div><span className="overline">ПРОВЕРЕННЫЕ РАБОТЫ</span><h2>Оценки</h2></div><span className="chart-caption">Число работ</span></div>{gradeChart.every((row) => row.value === 0) ? <EmptyState title="Пока нет проверенных работ" detail="Распределение появится после проверки." /> : <Suspense fallback={<div className="chart-loading" aria-label="Загружаем диаграмму" />}><GradeBarChart data={gradeChart} /></Suspense>}</GlassCard></div>}
    <GlassModal open={Boolean(removeAssignment)} title="Удалить задание?" onClose={() => { if (!removeTask.isPending) setRemoveAssignment(null); }}>{removeAssignment && <div className="confirm-copy"><p>«{removeAssignment.title}» перестанет быть доступным ученикам и исчезнет из списка заданий.</p><p>Уже отправленные работы и начисления сохранятся.</p><div className="modal-actions"><GlassButton variant="secondary" disabled={removeTask.isPending} onClick={() => setRemoveAssignment(null)}>Отмена</GlassButton><GlassButton variant="danger" disabled={removeTask.isPending} onClick={() => removeTask.mutate(removeAssignment.id)}>{removeTask.isPending ? "Удаляем…" : "Удалить задание"}</GlassButton></div></div>}</GlassModal>
    <GlassModal open={showCreator} title="Новая работа" onClose={() => setShowCreator(false)}><AssignmentComposer serverError={createError} onClearServerError={() => setCreateError("")} onCancel={() => setShowCreator(false)} onSave={(data, publish) => { setCreateError(""); create.mutate({ data, publish }); }} isSaving={create.isPending} /></GlassModal>
    <GlassModal open={Boolean(review)} title="Проверка работы" onClose={() => setReview(null)}>{review && <div className="review-modal"><div className="review-student"><Avatar user={{ name: review.student.name, firstName: review.student.name.split(" ")[1] ?? review.student.name[0], lastName: review.student.name.split(" ")[0], level: 1, totalExp: 0, balance: 0 }} size="sm" /><span><strong>{review.student.name}</strong><small>{review.student.className} · {review.assignment.title}</small></span></div>{review.answers.map((answer: any) => <div className="score-question" key={answer.question.id}><span>{answer.question.prompt}</span><p>{answer.text}</p>{answer.uploads.map((file: any) => <a href={file.url} target="_blank" rel="noreferrer" key={file.id}><img src={file.url} alt="Фото решения" /></a>)}<label className="field"><span>Баллы · максимум {answer.question.points}</span><input inputMode="numeric" type="number" min="0" max={answer.question.points} value={scores[answer.question.id] ?? "0"} onChange={(event) => setScores((current) => ({ ...current, [answer.question.id]: event.target.value }))} /></label></div>)}<label className="field"><span>Комментарий ученику</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Напиши короткую обратную связь" /></label><div className="modal-actions"><GlassButton variant="secondary" onClick={() => saveReview.mutate({ action: "return", comment })} disabled={saveReview.isPending || !comment.trim()}>Вернуть на доработку</GlassButton><GlassButton onClick={() => saveReview.mutate({ action: "complete", comment, scores: Object.fromEntries(Object.entries(scores).map(([key, value]) => [key, Number(value)])) })} disabled={saveReview.isPending}>Завершить проверку</GlassButton></div></div>}</GlassModal>
    
  </div>;
}

function assignmentCreationHelp(error: Error) {
  const reason = error.message.trim();
  if (reason.includes("Выбранный класс не закреплён") || reason.startsWith("Вопрос ") || reason.startsWith("Поле «")) return reason;
  if (reason.includes("Фото отсутствует") || reason.includes("Фото") && reason.includes("просрочено")) return "Одно из вложений не загрузилось, истекло или недоступно вашему профилю. Удалите это фото из списка, прикрепите его заново и повторите сохранение.";
  if (reason.includes("варианты выбора и ответы")) return "Один из быстрых вопросов не готов: для вопроса с вариантами нужно добавить минимум два варианта, а для каждого короткого/числового вопроса — заполнить поле «Правильный ответ(ы)». Исправьте указанный вопрос и повторите публикацию.";
  if (reason.includes("Срок сдачи должен быть позже") || reason.includes("Указанный срок уже прошёл")) return "Указанный срок уже прошёл. Выберите дату и время в будущем в поле «Общий срок» или очистите поле, если срок не нужен.";
  if (reason.includes("Нет школьной принадлежности")) return "У профиля нет подтверждённого членства в школе. Попросите школьного администратора подтвердить вашу роль учителя и членство, затем войдите снова.";
  if (/^Ошибка запроса \(5\d\d\)/u.test(reason) || /Failed to fetch|NetworkError/u.test(reason)) return "Сервер не ответил при сохранении. Заполненные поля остались в форме: попробуйте отправить ещё раз. Если сообщение повторится, сохраните черновик и передайте администратору точное время ошибки.";
  return `Сохранение отклонено: ${reason || "сервер не сообщил причину"}. Исправьте названное поле или условие и повторите попытку; введённые данные останутся в этой форме.`;
}

function AssignmentComposer({ serverError, onClearServerError, onCancel, onSave, isSaving }: { serverError: string; onClearServerError: () => void; onCancel: () => void; onSave: (data: unknown, publish: boolean) => void; isSaving: boolean }) {
  const [questions, setQuestions] = useState<Array<{ prompt: string; type: string; points: number; options: string[]; acceptedAnswers: string[]; tolerance: number }>>([{ prompt: "", type: "SHORT_TEXT", points: 1, options: [""], acceptedAnswers: [""], tolerance: 0 }]);
  const [form, setForm] = useState({ title: "", subject: "", category: "Учёба", description: "", dueAt: "", durationMinutes: "" });
  const [error, setError] = useState("");
  const [classIds, setClassIds] = useState<string[]>([]);
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const save = (publish: boolean) => {
    setError("");
    if (!form.title.trim()) { setError("Поле «Название» пустое. Введите название работы от 1 до 120 символов."); return; }
    if (form.title.trim().length > 120) { setError("Поле «Название» длиннее 120 символов. Сократите его."); return; }
    if (!form.subject.trim()) { setError("Поле «Предмет» пустое. Укажите предмет (от 1 до 100 символов)."); return; }
    if (form.subject.trim().length > 100) { setError("Поле «Предмет» длиннее 100 символов. Сократите его."); return; }
    if (!form.description.trim()) { setError("Поле «Описание и условия» пустое. Добавьте инструкцию для ученика."); return; }
    if (form.description.trim().length > 8000) { setError("Описание и условия превышают 8 000 символов. Сократите текст."); return; }
    if (!classIds.length) { setError("Класс не выбран. Отметьте хотя бы один закреплённый за вами класс. Если список пуст, попросите администратора назначить вас учителем класса."); return; }
    if (classIds.length > 10) { setError("Выбрано больше 10 классов. Оставьте не более десяти классов в этой работе."); return; }
    if (form.dueAt && Number.isNaN(new Date(form.dueAt).getTime())) { setError("Дата в поле «Общий срок» не распознана. Выберите дату из календаря или очистите поле."); return; }
    if (publish && form.dueAt && new Date(form.dueAt).getTime() <= Date.now()) { setError("Срок сдачи уже прошёл. Выберите дату и время в будущем или очистите поле «Общий срок»."); return; }
    if (form.durationMinutes && (!Number.isInteger(Number(form.durationMinutes)) || Number(form.durationMinutes) < 1 || Number(form.durationMinutes) > 240)) { setError("Поле «Время после старта» должно быть целым числом от 1 до 240 минут. Измените значение или очистите поле."); return; }
    if (questions.length < 1 || questions.length > 40) { setError("В работе должно быть от 1 до 40 вопросов. Удалите лишние вопросы или добавьте хотя бы один."); return; }
    const invalidQuestion = questions.findIndex((question) => !question.prompt.trim() || question.prompt.trim().length > 2000);
    if (invalidQuestion >= 0) { setError(`Вопрос ${invalidQuestion + 1}: условие пустое или длиннее 2 000 символов. Заполните его или сократите текст.`); return; }
    const invalidPoints = questions.findIndex((question) => !Number.isInteger(Number(question.points)) || Number(question.points) < 1 || Number(question.points) > 100);
    if (invalidPoints >= 0) { setError(`Вопрос ${invalidPoints + 1}: максимум баллов должен быть целым числом от 1 до 100. Исправьте значение.`); return; }
    const invalidChoice = questions.findIndex((question) => question.type === "SINGLE_CHOICE" && (question.options.filter(Boolean).length < 2 || question.options.filter(Boolean).length > 8));
    if (invalidChoice >= 0) { setError(`Вопрос ${invalidChoice + 1}: для типа «Один вариант» нужно от 2 до 8 вариантов. Перечислите их через запятую в поле «Варианты ответа».`); return; }
    const longOption = questions.findIndex((question) => question.type === "SINGLE_CHOICE" && question.options.some((option) => option.trim().length > 200));
    if (longOption >= 0) { setError(`Вопрос ${longOption + 1}: каждый вариант ответа должен быть не длиннее 200 символов. Сократите его.`); return; }
    const missingAnswer = questions.findIndex((question) => question.type !== "LONG_ANSWER" && !question.acceptedAnswers.some(Boolean));
    if (missingAnswer >= 0) { setError(`Вопрос ${missingAnswer + 1}: правильный ответ не заполнен. Введите его в поле «Правильный ответ(ы)».`); return; }
    const tooManyAnswers = questions.findIndex((question) => question.acceptedAnswers.filter(Boolean).length > 20);
    if (tooManyAnswers >= 0) { setError(`Вопрос ${tooManyAnswers + 1}: указано больше 20 правильных ответов. Удалите лишние варианты.`); return; }
    const longAnswer = questions.findIndex((question) => question.acceptedAnswers.some((answer) => answer.trim().length > 100));
    if (longAnswer >= 0) { setError(`Вопрос ${longAnswer + 1}: каждый правильный ответ должен быть не длиннее 100 символов. Сократите его.`); return; }
    const invalidTolerance = questions.findIndex((question) => question.type === "NUMBER" && (!Number.isFinite(Number(question.tolerance)) || Number(question.tolerance) < 0 || Number(question.tolerance) > 1_000_000));
    if (invalidTolerance >= 0) { setError(`Вопрос ${invalidTolerance + 1}: допустимая погрешность должна быть от 0 до 1 000 000. Исправьте значение.`); return; }
    onSave({ ...form, classIds, photoFileIds: photoIds, dueAt: form.dueAt ? new Date(form.dueAt).toISOString() : null, durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : null, questions: questions.map((question) => ({ ...question, points: Number(question.points), options: question.type === "SINGLE_CHOICE" ? question.options.filter(Boolean) : [], acceptedAnswers: question.type === "LONG_ANSWER" ? [] : question.acceptedAnswers.filter(Boolean), photoRequired: question.type === "LONG_ANSWER" })) }, publish);
  };
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const chosen = Array.from(files);
    if (photoIds.length + chosen.length > 5) { setError("К работе можно добавить не более пяти фото."); return; }
    setUploading(true); setError("");
    try { const data = new FormData(); chosen.forEach((file) => data.append("file", file)); const result = await api<{ files: Array<{ id: string }> }>("/files", { method: "POST", body: data }); setPhotoIds((ids) => [...ids, ...result.files.map((file) => file.id)]); }
    catch (cause) { setError((cause as Error).message); }
    finally { setUploading(false); }
  };
  return <form className="assignment-composer" noValidate onChange={() => { if (serverError) onClearServerError(); if (error) setError(""); }} onSubmit={(event) => { event.preventDefault(); save(true); }}>
    <p className="modal-intro">Сохрани черновик и вернись к нему позже или сразу опубликуй выбранному классу.</p>
    <div className="composer-fields"><GlassInput label="Название" required maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /><GlassInput label="Предмет" required maxLength={100} value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /><label className="field"><span>Категория</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>{["Учёба", "Творчество", "Спорт", "Волонтёрство", "Школьная жизнь"].map((item) => <option key={item}>{item}</option>)}</select></label><GlassInput label="Общий срок" type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} hint="Пустое значение — без общего срока." /><GlassInput label="Время после старта · минут" type="number" min={1} max={240} value={form.durationMinutes} onChange={(event) => setForm({ ...form, durationMinutes: event.target.value })} hint="Таймер запускается только по кнопке ученика." /><label className="field composer-wide"><span>Описание и условия</span><textarea required maxLength={8000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label></div>
    <fieldset className="class-picker"><legend>Назначить классам</legend><p className="field-helper">Работа будет доступна ученикам выбранных классов.</p><ClassSelector onChange={setClassIds} /></fieldset>
    <section className="composer-photo-section"><h3>Фото к заданию</h3><p>JPEG, PNG или WebP · до 10 МБ на фото · не более пяти изображений.</p><label className="upload-drop"><input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Прикрепить фото к заданию" disabled={uploading || photoIds.length >= 5} onChange={(event) => { void addPhotos(event.currentTarget.files); event.currentTarget.value = ""; }} /><span className="upload-icon"><Plus size={19} /></span><strong>{uploading ? "Загружаем фото…" : "Прикрепить фото к заданию"}</strong><small>Фото станет доступно назначенному классу после публикации.</small></label>{photoIds.length > 0 && <div className="uploaded-files">{photoIds.map((id) => <span key={id}><img src={`/api/files/${id}`} alt="Фото к заданию" /><button type="button" aria-label="Удалить фото к заданию" onClick={() => setPhotoIds((current) => current.filter((value) => value !== id))}><X size={14} /></button></span>)}</div>}</section>
    <div className="composer-questions"><div className="section-card-heading"><div><span className="overline">КОНСТРУКТОР</span><h3>Вопросы</h3></div><GlassButton type="button" variant="secondary" onClick={() => setQuestions((rows) => [...rows, { prompt: "", type: "SHORT_TEXT", points: 1, options: [""], acceptedAnswers: [""], tolerance: 0 }])}><Plus size={15} /> Добавить вопрос</GlassButton></div>{questions.map((question, index) => <div className="composer-question" key={index}><div className="composer-question-top"><span className="question-index">{String(index + 1).padStart(2, "0")}</span><label className="field"><span>Тип вопроса</span><select value={question.type} onChange={(event) => setQuestions((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, type: event.target.value } : row))}>{[["SHORT_TEXT", "Короткий текст"], ["NUMBER", "Число"], ["SINGLE_CHOICE", "Один вариант"], ["LONG_ANSWER", "Развёрнутый ответ · с фото"]].map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><GlassInput label="Максимум баллов" type="number" min={1} max={100} value={question.points} onChange={(event) => setQuestions((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, points: Number(event.target.value) } : row))} /><button type="button" className="icon-button remove-question" aria-label="Удалить вопрос" disabled={questions.length < 2} onClick={() => setQuestions((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}><X size={17} /></button></div><label className="field"><span>Условие</span><textarea required value={question.prompt} onChange={(event) => setQuestions((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, prompt: event.target.value } : row))} /></label>{question.type === "SINGLE_CHOICE" && <label className="field"><span>Варианты ответа · через запятую</span><input value={question.options.join(", ")} onChange={(event) => setQuestions((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, options: event.target.value.split(",").map((value) => value.trim()) } : row))} /></label>}{question.type === "NUMBER" && <GlassInput label="Допустимая погрешность числа" type="number" min={0} step="any" value={question.tolerance} onChange={(event) => setQuestions((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, tolerance: Number(event.target.value) } : row))} hint="Например, 0,2 примет ответ в пределах двадцати сотых." />}{question.type !== "LONG_ANSWER" && <label className="field"><span>Правильный ответ(ы)</span><input value={question.acceptedAnswers.join(", ")} onChange={(event) => setQuestions((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, acceptedAnswers: event.target.value.split(",").map((value) => value.trim()) } : row))} /></label>}</div>)}</div>
    {(serverError || error) && <div className="assignment-error-panel" role="alert"><strong>{serverError ? "Не удалось сохранить задание" : "Проверьте форму"}</strong><p>{serverError || error}</p></div>}<div className="modal-actions"><GlassButton type="button" variant="secondary" onClick={onCancel}>Закрыть без сохранения</GlassButton><GlassButton type="button" variant="secondary" disabled={isSaving || uploading} onClick={() => save(false)}>Сохранить черновик</GlassButton><GlassButton type="submit" disabled={isSaving || uploading}>{isSaving ? "Сохраняем…" : "Опубликовать работу"}<ArrowRight size={16} /></GlassButton></div>
  </form>;
}

function ClassSelector({ onChange }: { onChange: (ids: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const classes = useQuery({ queryKey: ["teacher-classes"], queryFn: () => api<Array<{ id: string; name: string }>>("/teacher/classes"), retry: false });
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
    setSelected(next);
    onChange(next);
  };
  if (classes.isLoading) return <p className="field-helper">Загружаем закреплённые классы…</p>;
  if (classes.isError) return <p className="error-text">{(classes.error as Error).message}</p>;
  return <>{classes.data?.map((schoolClass) => <label className="class-option" key={schoolClass.id}><input type="checkbox" checked={selected.includes(schoolClass.id)} onChange={() => toggle(schoolClass.id)} />{schoolClass.name}</label>)}{!classes.data?.length && <p className="field-helper">Сначала администратор школы должен закрепить за вами классы.</p>}</>;
}

function AdminClassManager({ users, toast }: { users: any[]; toast: ToastHook }) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [newName, setNewName] = useState("");
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [editingClass, setEditingClass] = useState<{ id: string; name: string } | null>(null);
  const [targetTeacher, setTargetTeacher] = useState<Record<string, string>>({});
  const [targetStudentClass, setTargetStudentClass] = useState<Record<string, string>>({});
  const [confirmation, setConfirmation] = useState<{ id: string; name: string; action: "delete" | "archive" } | null>(null);
  const classes = useQuery({ queryKey: ["admin-classes", query, status], queryFn: () => api<any[]>(`/admin/classes?status=${status}&q=${encodeURIComponent(query)}`) });
  const activeClasses = useQuery({ queryKey: ["admin-classes-targets"], queryFn: () => api<any[]>("/admin/classes?status=active") });
  const refresh = () => { void client.invalidateQueries({ queryKey: ["admin-classes"] }); void client.invalidateQueries({ queryKey: ["admin-classes-targets"] }); void client.invalidateQueries({ queryKey: ["teacher-classes"] }); void client.invalidateQueries({ queryKey: ["teacher-overview"] }); void client.invalidateQueries({ queryKey: ["admin-users"] }); };
  const act = async (url: string, method = "POST", body: unknown = {}) => {
    try { const result = await api<any>(url, { method, body: jsonBody(body) }); toast.show("Изменение сохранено"); refresh(); return result; }
    catch (error) { toast.show((error as Error).message); return null; }
  };
  const teachers = users.filter((user) => user.isTeacher && !user.blocked);
  if (classes.isLoading || activeClasses.isLoading) return <GlassCard className="admin-classes-card"><LoadingState label="Загружаем классы" /></GlassCard>;
  if (classes.isError || activeClasses.isError) return <ErrorState title="Не удалось загрузить список классов" detail={(classes.error ?? activeClasses.error as Error)?.message} retry={() => { void classes.refetch(); void activeClasses.refetch(); }} />;
  return <>
    <GlassCard className="admin-classes-card">
      <div className="section-card-heading"><div><span className="overline">СТРУКТУРА ШКОЛЫ</span><h2>Классы</h2><p className="soft-text">Список ограничен текущей школой; изменения сразу видны учителям и ученикам.</p></div><label className="search-box"><Search size={16} /><input aria-label="Поиск классов" placeholder="Найти класс" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
      <div className="class-list-toolbar"><label className="field"><span>Показать</span><select value={status} onChange={(event) => setStatus(event.target.value as "active" | "archived")}><option value="active">Активные классы</option><option value="archived">Архив</option></select></label><form className="class-create-row" onSubmit={(event) => { event.preventDefault(); void act("/admin/classes", "POST", { name: newName }).then((created) => { if (created) { setNewName(""); setStatus("active"); } }); }}><GlassInput label="Название нового класса" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Например, 10А" maxLength={40} required /><GlassButton type="submit" variant="secondary" disabled={!newName.trim()}>Создать класс</GlassButton></form></div>
      {classes.data!.length ? <div className="admin-class-list">{classes.data!.map((schoolClass: any) => <article className="admin-class-item" key={schoolClass.id}>
        <div className="admin-class-summary"><div className="admin-class-title"><strong>{schoolClass.name}</strong>{schoolClass.archivedAt && <span className="archive-chip">Архив</span>}<small>{schoolClass.studentCount} учеников · {schoolClass.teacherCount} учителей · {schoolClass.assignmentCount} учебных назначений</small></div><div className="admin-class-actions"><GlassButton variant="secondary" onClick={() => setSelectedClassId(selectedClassId === schoolClass.id ? null : schoolClass.id)}>{selectedClassId === schoolClass.id ? "Закрыть" : "Открыть"}</GlassButton>{!schoolClass.archivedAt && <GlassButton variant="secondary" onClick={() => setEditingClass({ id: schoolClass.id, name: schoolClass.name })}>Редактировать</GlassButton>}{schoolClass.archivedAt ? <GlassButton variant="secondary" onClick={() => void act(`/admin/classes/${schoolClass.id}/restore`)}>Восстановить</GlassButton> : <GlassButton variant="secondary" onClick={() => setConfirmation({ id: schoolClass.id, name: schoolClass.name, action: "archive" })}>В архив</GlassButton>}<GlassButton variant="danger" disabled={Boolean(schoolClass.membershipCount || schoolClass.teacherLinkCount || schoolClass.assignmentCount)} title={schoolClass.membershipCount || schoolClass.teacherLinkCount || schoolClass.assignmentCount ? "Есть связи или история — используйте архивирование" : "Удалить только полностью пустой класс"} onClick={() => setConfirmation({ id: schoolClass.id, name: schoolClass.name, action: "delete" })}>Удалить</GlassButton></div></div>
        {schoolClass.inactiveMembershipCount > 0 && <p className="class-dependency-note">Исторических связей: {schoolClass.inactiveMembershipCount}. Удаление недоступно; архив сохраняет историю.</p>}
        {schoolClass.pendingWorkCount > 0 && <p className="class-dependency-note">Незавершённых сдач: {schoolClass.pendingWorkCount}. Перед архивом завершите или передайте проверку.</p>}
        {editingClass?.id === schoolClass.id && <form className="class-edit-row" onSubmit={(event) => { event.preventDefault(); const current = editingClass; if (!current) return; void act(`/admin/classes/${schoolClass.id}`, "PATCH", { name: current.name }).then((updated) => { if (updated) setEditingClass(null); }); }}><GlassInput label="Новое название класса" value={editingClass?.name ?? ""} onChange={(event) => setEditingClass((current) => current ? { ...current, name: event.target.value } : current)} maxLength={40} required /><GlassButton type="submit" disabled={!editingClass?.name.trim()}>Сохранить название</GlassButton><GlassButton type="button" variant="secondary" onClick={() => setEditingClass(null)}>Отмена</GlassButton></form>}
        {selectedClassId === schoolClass.id && <div className="admin-class-detail"><section><h3>Учителя класса</h3>{schoolClass.teachers.length ? <div className="class-people-list">{schoolClass.teachers.map((teacher: any) => <div className="class-person-row" key={teacher.membershipId}><span>{teacher.name}</span><button className="text-button" onClick={() => void act(`/admin/classes/${schoolClass.id}/teachers/${teacher.membershipId}`, "PUT", { enabled: false })}>Снять назначение</button></div>)}</div> : <EmptyState title="Учителя пока не назначены" detail="Назначьте роль учителя в списке пользователей, затем закрепите его за классом здесь." />}<div className="class-assignment-row"><label className="field"><span>Выбрать действующего учителя</span><select aria-label={`Учитель для класса ${schoolClass.name}`} value={targetTeacher[schoolClass.id] ?? ""} onChange={(event) => setTargetTeacher({ ...targetTeacher, [schoolClass.id]: event.target.value })}><option value="">Выбрать учителя</option>{teachers.map((person: any) => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><GlassButton variant="secondary" disabled={!targetTeacher[schoolClass.id] || Boolean(schoolClass.archivedAt)} onClick={async () => { const teacherId = targetTeacher[schoolClass.id]!; const saved = await act(`/admin/classes/${schoolClass.id}/teachers/${teacherId}`, "PUT", { enabled: true }); if (saved) setTargetTeacher({ ...targetTeacher, [schoolClass.id]: "" }); }}>Назначить учителя</GlassButton></div>{!teachers.length && <p className="field-helper">В школе пока нет действующих учителей. Пользователь остаётся учеником, пока вы явно не назначите ему роль.</p>}</section>
          <section><h3>Ученики класса</h3>{schoolClass.students.length ? <div className="class-people-list">{schoolClass.students.map((student: any) => <div className="class-person-row class-transfer-row" key={student.membershipId}><span>{student.name}</span><label className="field"><span className="sr-only">Новый класс для {student.name}</span><select aria-label={`Куда перевести ${student.name}`} value={targetStudentClass[student.membershipId] ?? ""} onChange={(event) => setTargetStudentClass({ ...targetStudentClass, [student.membershipId]: event.target.value })}><option value="">Выбрать целевой класс</option>{activeClasses.data!.filter((item: any) => item.id !== schoolClass.id).map((item: any) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><GlassButton variant="secondary" disabled={!targetStudentClass[student.membershipId]} onClick={() => void act(`/admin/memberships/${student.membershipId}/class`, "PATCH", { classId: targetStudentClass[student.membershipId] }).then((saved) => { if (saved) setTargetStudentClass({ ...targetStudentClass, [student.membershipId]: "" }); })}>Перевести</GlassButton></div>)}</div> : <EmptyState title="Активных учеников пока нет" detail="Связанные работы и оценки остаются сохранёнными." />}</section></div>}
      </article>)}</div> : <EmptyState title={status === "archived" ? "В архиве пока нет классов" : "Пока нет классов"} detail={status === "archived" ? "Архивированные классы появятся здесь." : "Создайте первый класс школы формой выше."} />}
    </GlassCard>
    <GlassModal open={Boolean(confirmation)} title={confirmation?.action === "delete" ? "Удалить пустой класс?" : "Архивировать класс?"} onClose={() => setConfirmation(null)}><div className="confirm-copy"><p>Класс «{confirmation?.name}».</p>{confirmation?.action === "delete" ? <p>Сервер удаляет запись только если у неё нет пользователей, учителей и назначений работ. Связанные данные каскадом не удаляются.</p> : <p>Архив сохраняет учебную историю. Перед подтверждением переведите активных учеников и завершите или передайте незакрытые работы.</p>}</div><div className="modal-actions"><GlassButton variant="secondary" onClick={() => setConfirmation(null)}>Отмена</GlassButton><GlassButton variant={confirmation?.action === "delete" ? "danger" : "primary"} onClick={async () => { if (!confirmation) return; const current = confirmation; const saved = await act(current.action === "delete" ? `/admin/classes/${current.id}` : `/admin/classes/${current.id}/archive`, current.action === "delete" ? "DELETE" : "POST"); if (saved) { setConfirmation(null); setSelectedClassId(null); } }}>{confirmation?.action === "delete" ? "Подтвердить удаление" : "Подтвердить архив"}</GlassButton></div></GlassModal>
  </>;
}

type TeacherClassOption = { id: string; name: string; selected: boolean };
function OwnTeacherClassEditor({ toast, onClose }: { toast: ToastHook; onClose: () => void }) {
  const options = useQuery({ queryKey: ["teacher-class-options"], queryFn: () => api<TeacherClassOption[]>("/teacher/class-options") });
  return <GlassModal open title="Мои классы" onClose={onClose}>{options.isLoading ? <LoadingState label="Загружаем классы" /> : options.isError ? <ErrorState title="Классы недоступны" detail={(options.error as Error).message} retry={() => void options.refetch()} /> : <OwnTeacherClassForm options={options.data ?? []} toast={toast} onClose={onClose} />}</GlassModal>;
}
function OwnTeacherClassForm({ options, toast, onClose }: { options: TeacherClassOption[]; toast: ToastHook; onClose: () => void }) {
  const client = useQueryClient();
  const [classIds, setClassIds] = useState(() => options.filter((row) => row.selected).map((row) => row.id));
  const save = useMutation({ mutationFn: () => api("/teacher/classes", { method: "PUT", body: jsonBody({ classIds }) }), onSuccess: () => { toast.show("Классы сохранены"); client.setQueryData<TeacherClassOption[]>(["teacher-class-options"], (rows) => rows?.map((row) => ({ ...row, selected: classIds.includes(row.id) }))); void client.invalidateQueries({ queryKey: ["teacher-class-options"] }); void client.invalidateQueries({ queryKey: ["teacher-classes"] }); void client.invalidateQueries({ queryKey: ["teacher-submissions"] }); void client.invalidateQueries({ queryKey: ["admin-users"] }); void client.invalidateQueries({ queryKey: ["admin-classes"] }); onClose(); }, onError: (error: Error) => toast.show(error.message) });
  return <><p className="soft-text">Выберите классы, в которых преподаёте. Свои прежние работы и ответы можно будет проверить и после снятия класса.</p><div className="teacher-class-picker">{options.length ? options.map((schoolClass) => <label className="teacher-class-option" key={schoolClass.id}><input type="checkbox" checked={classIds.includes(schoolClass.id)} onChange={() => setClassIds((current) => current.includes(schoolClass.id) ? current.filter((id) => id !== schoolClass.id) : [...current, schoolClass.id])} /><span><strong>{schoolClass.name}</strong></span></label>) : <EmptyState title="В школе пока нет активных классов" detail="Попросите администратора школы добавить класс." />}</div><div className="modal-actions"><GlassButton variant="secondary" onClick={onClose}>Отмена</GlassButton><GlassButton disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Сохраняем…" : "Сохранить классы"}</GlassButton></div></>;
}

function TeacherClassEditor({ teacher, toast, onClose }: { teacher: any; toast: ToastHook; onClose: () => void }) {
  const client = useQueryClient();
  const classes = useQuery({ queryKey: ["teacher-class-editor-options"], queryFn: () => api<any[]>("/admin/classes?status=active") });
  const [classIds, setClassIds] = useState<string[]>(teacher.teacherClassIds ?? []);
  const save = useMutation({
    mutationFn: () => api(`/admin/memberships/${teacher.id}/teacher-classes`, { method: "PUT", body: jsonBody({ classIds }) }),
    onSuccess: () => { toast.show("Назначения учителя сохранены"); void client.invalidateQueries({ queryKey: ["admin-users"] }); void client.invalidateQueries({ queryKey: ["admin-classes"] }); void client.invalidateQueries({ queryKey: ["teacher-class-editor-options"] }); void client.invalidateQueries({ queryKey: ["teacher-classes"] }); void client.invalidateQueries({ queryKey: ["teacher-class-options"] }); onClose(); },
    onError: (error: Error) => toast.show(error.message),
  });
  return <GlassModal open title={`Классы учителя · ${teacher.name}`} onClose={onClose}><div className="teacher-class-picker"><p className="soft-text">Изменение здесь и в карточке класса обновляет один список назначений. Свои прежние работы и ответы останутся доступны учителю.</p>{classes.isLoading ? <LoadingState label="Загружаем классы" /> : classes.isError ? <ErrorState title="Классы недоступны" detail={(classes.error as Error).message} retry={() => void classes.refetch()} /> : classes.data!.length ? classes.data!.map((schoolClass) => <label className="teacher-class-option" key={schoolClass.id}><input type="checkbox" checked={classIds.includes(schoolClass.id)} onChange={() => setClassIds((current) => current.includes(schoolClass.id) ? current.filter((id) => id !== schoolClass.id) : [...current, schoolClass.id])} /><span><strong>{schoolClass.name}</strong><small>{schoolClass.studentCount} учеников · {schoolClass.teacherCount} назначенных учителей</small></span></label>) : <EmptyState title="В школе пока нет активных классов" detail="Сначала создайте класс, затем назначьте его учителю." />}</div><div className="modal-actions"><GlassButton variant="secondary" onClick={onClose}>Отмена</GlassButton><GlassButton disabled={classes.isLoading || classes.isError || save.isPending || !classes.data?.length} onClick={() => save.mutate()}>{save.isPending ? "Сохраняем…" : "Сохранить классы"}</GlassButton></div></GlassModal>;
}

function AdminPage({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const [period, setPeriod] = useState<"30" | "all">("30");
  const overview = useQuery({ queryKey: ["admin-overview", period], queryFn: () => api<any>(`/admin/overview?days=${period}`) });
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api<any[]>("/admin/users") });
  const requests = useQuery({ queryKey: ["join-requests"], queryFn: () => api<any[]>("/admin/join-requests") });
  const orders = useQuery({ queryKey: ["admin-orders"], queryFn: () => api<any[]>("/admin/orders") });
  const [search, setSearch] = useState("");
  const [editingTeacher, setEditingTeacher] = useState<any | null>(null);
  const [removeStudent, setRemoveStudent] = useState<any | null>(null);
  const [isRemovingStudent, setIsRemovingStudent] = useState(false);
  const act = async (url: string, method = "POST", body: unknown = {}) => {
    try { await api(url, { method, body: jsonBody(body) }); toast.show("Изменение сохранено"); void client.invalidateQueries({ queryKey: ["admin-overview"] }); void client.invalidateQueries({ queryKey: ["admin-users"] }); void client.invalidateQueries({ queryKey: ["admin-classes"] }); void client.invalidateQueries({ queryKey: ["join-requests"] }); void client.invalidateQueries({ queryKey: ["admin-orders"] }); return true; }
    catch (error) { toast.show((error as Error).message); return false; }
  };
  if (overview.isLoading || users.isLoading || requests.isLoading || orders.isLoading) return <LoadingState label="Открываем панель школы" />;
  const error = overview.error ?? users.error ?? requests.error ?? orders.error;
  if (error) return <ErrorState title="Панель школы недоступна" detail={(error as Error).message} retry={() => { void overview.refetch(); void users.refetch(); void requests.refetch(); void orders.refetch(); }} />;
  const filteredUsers = users.data!.filter((user) => `${user.name} ${user.class} ${user.username ?? ""}`.toLocaleLowerCase("ru-RU").includes(search.toLocaleLowerCase("ru-RU")));
  const gradeData = Object.entries(overview.data.gradeDistribution).map(([grade, value]) => ({ name: grade, value: Number(value) }));
  return <div className="content-stack admin-page"><PageHeading eyebrow="УПРАВЛЕНИЕ ШКОЛОЙ" title="Панель школы" detail={`${overview.data.school?.name} · сводные данные ${period === "all" ? "за всё время" : "за 30 дней"}`} action={<div className="admin-period-controls" role="group" aria-label="Период статистики"><button type="button" className={period === "30" ? "selected" : ""} aria-pressed={period === "30"} onClick={() => setPeriod("30")}>30 дней</button><button type="button" className={period === "all" ? "selected" : ""} aria-pressed={period === "all"} onClick={() => setPeriod("all")}>Всё время</button></div>} />
    <div className="admin-kpi-grid"><StatTile icon={<Users size={18} />} label="Активные ученики" value={`${overview.data.activeStudents.active}/${overview.data.activeStudents.total}`} detail={overview.data.activeStudents.percent === null ? "нет данных" : `${overview.data.activeStudents.percent}% за период`} /><StatTile icon={<BookOpen size={18} />} label="Работы" value={overview.data.assignments} detail={`${overview.data.submissions} сдач`} /><StatTile icon={<Clock3 size={18} />} label="Ожидают проверки" value={overview.data.pending} detail="только в этой школе" /></div>
    <div className="admin-mid-grid"><GlassCard className="admin-chart-card"><div className="section-card-heading"><div><span className="overline">РАСПРЕДЕЛЕНИЕ</span><h2>Оценки</h2></div></div>{gradeData.every((row) => row.value === 0) ? <p className="soft-text">За выбранный период нет оценок.</p> : <div className="donut-holder"><Suspense fallback={<div className="chart-loading" aria-label="Загружаем диаграмму" />}><GradePieChart data={gradeData} /></Suspense><div className="donut-center"><strong>{overview.data.completion.done}</strong><small>проверено</small></div></div>}<div className="grade-legend">{gradeData.map((row) => <span key={row.name}><b>Оценка {row.name}</b><strong>{row.value}</strong></span>)}</div></GlassCard><GlassCard className="admin-invite-card"><span className="invite-orb"><Users size={19} /></span><span className="overline">ЗАЯВКИ НА ВСТУПЛЕНИЕ</span><h2>{requests.data!.length ? `${requests.data!.length} ждут решения` : "Пока без заявок"}</h2><p>Каждая заявка проверяется в контексте вашей школы.</p>{requests.data!.slice(0, 3).map((row: any) => <div className="join-request-row" key={row.id}><div><strong>{row.user.name}</strong><small>{row.className === "—" ? "Класс уточняется" : `Класс ${row.className}`}</small></div><div><button className="approve-small" onClick={() => void act(`/admin/join-requests/${row.id}/approve`)} aria-label="Подтвердить заявку"><Check size={16} /></button><button className="reject-small" onClick={() => void act(`/admin/join-requests/${row.id}/reject`)} aria-label="Отклонить заявку"><X size={16} /></button></div></div>)}</GlassCard></div>
    <AdminClassManager users={users.data!} toast={toast} />
    <GlassCard className="admin-users-card"><div className="section-card-heading"><div><span className="overline">ПОЛЬЗОВАТЕЛИ · ПО АЛФАВИТУ</span><h2>Школьное сообщество</h2></div><label className="search-box"><Search size={16} /><input placeholder="Найти человека" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div><div className="responsive-table"><table><thead><tr><th>Имя</th><th>Класс</th><th>Роль</th><th>Состояние</th><th>Доступ учителя</th><th>Классы учителя</th><th>Действие</th></tr></thead><tbody>{filteredUsers.map((row: any) => <tr key={row.id}><td><strong>{row.name}</strong>{row.username && <small>@{row.username}</small>}</td><td>{row.isTeacher ? (row.teacherClassNames?.join(", ") || "Не выбраны") : row.class}</td><td>{row.isSchoolAdmin ? "Администратор" : row.isTeacher ? "Учитель" : "Ученик"}</td><td>{row.accountBlocked ? "Заблокирован" : row.active ? "Активен" : "Исключён"}</td><td>{row.role !== "SCHOOL_ADMIN" && !row.blocked && <button className={`role-toggle ${row.isTeacher ? "enabled" : ""}`} onClick={() => void act(`/admin/memberships/${row.id}/teacher`, "PUT", { enabled: !row.isTeacher, classIds: [] })}>{row.isTeacher ? "Снять роль" : "Назначить учителем"}</button>}{row.isSchoolAdmin && <small>Доступен</small>}</td><td>{row.isTeacher && !row.blocked ? <button className="text-button" onClick={() => setEditingTeacher(row)}>Настроить ({row.teacherClassIds.length})</button> : "—"}</td><td>{row.role === "STUDENT" && !row.isTeacher && !row.isSchoolAdmin && !row.blocked ? <button className="text-button danger-text" onClick={() => setRemoveStudent(row)}>Исключить из школы</button> : "—"}</td></tr>)}</tbody></table></div></GlassCard>
    <SchoolProductManager toast={toast} />
    <GlassCard className="admin-orders-card"><div className="section-card-heading"><div><span className="overline">ШКОЛЬНЫЕ НАГРАДЫ</span><h2>Заказы на выдачу</h2></div><Gift size={18} /></div>{orders.data!.filter((row) => row.status === "RESERVED").length ? <div className="orders-list">{orders.data!.filter((row) => row.status === "RESERVED").map((order: any) => <div className="order-row" key={order.id}><span className="order-art art-book">◇</span><div><strong>{order.name}</strong><small>{order.student.name} · {order.student.className} · {order.code}</small></div><GlassButton variant="secondary" onClick={() => void act(`/admin/orders/${order.id}/fulfill`)}>Подтвердить выдачу</GlassButton></div>)}</div> : <EmptyState title="Нет невыданных заказов" detail="Заказы школьного маркета появятся здесь." />}</GlassCard>
    <p className="soft-footnote"><ShieldCheck size={15} /> Списки учеников не показывают коллекции, EXP, балансы и личные цели.</p>{editingTeacher && <TeacherClassEditor key={editingTeacher.id} teacher={editingTeacher} toast={toast} onClose={() => setEditingTeacher(null)} />}
    <GlassModal open={Boolean(removeStudent)} title="Исключить ученика из школы?" onClose={() => !isRemovingStudent && setRemoveStudent(null)}>{removeStudent && <div className="confirm-copy"><p><strong>{removeStudent.name}</strong> · {overview.data.school?.name}</p><p>Ученик потеряет доступ к школе. Его аккаунт, выполненные работы, оценки и история останутся сохранены.</p><div className="modal-actions"><GlassButton variant="secondary" disabled={isRemovingStudent} onClick={() => setRemoveStudent(null)}>Отмена</GlassButton><GlassButton variant="danger" disabled={isRemovingStudent} onClick={async () => { if (!removeStudent) return; setIsRemovingStudent(true); const saved = await act(`/admin/memberships/${removeStudent.id}/leave`); if (saved) setRemoveStudent(null); setIsRemovingStudent(false); }}>{isRemovingStudent ? "Исключаем…" : "Исключить из школы"}</GlassButton></div></div>}</GlassModal>
  </div>;
}

function OwnerSchoolsPage({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [showCreate, setShowCreate] = useState(false);
  const [schoolForm, setSchoolForm] = useState({ name: "", city: "", timezone: "Europe/Moscow" });
  const [expandedSchool, setExpandedSchool] = useState<string | null>(null);
  const [editingSchool, setEditingSchool] = useState<{ id: string; name: string; city: string; timezone: string } | null>(null);
  const [adminCandidates, setAdminCandidates] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ id: string; name: string; action: "archive" | "delete" } | null>(null);
  const requestKey = useRef(crypto.randomUUID());
  const schools = useQuery({ queryKey: ["owner-schools", query, status], queryFn: () => api<any[]>(`/owner/schools?status=${status}&q=${encodeURIComponent(query)}`) });
  const ownerUsers = useQuery({ queryKey: ["owner-admin-candidates", expandedSchool], queryFn: () => api<any[]>(`/owner/users?scope=candidates&schoolId=${encodeURIComponent(expandedSchool ?? "")}`), enabled: Boolean(expandedSchool), retry: false });
  const refresh = () => { void client.invalidateQueries({ queryKey: ["owner-schools"] }); void client.invalidateQueries({ queryKey: ["owner-overview"] }); void client.invalidateQueries({ queryKey: ["owner-admin-candidates"] }); void client.invalidateQueries({ queryKey: ["owner-users"] }); };
  const act = async (url: string, method = "POST", body: unknown = {}) => { try { const result = await api<any>(url, { method, body: jsonBody(body) }); toast.show("Изменение сохранено"); refresh(); return result; } catch (error) { toast.show((error as Error).message); return null; } };
  if (schools.isLoading) return <LoadingState label="Загружаем школы проекта" />;
  if (schools.isError) return <ErrorState title="Список школ недоступен" detail={(schools.error as Error).message} retry={() => void schools.refetch()} />;
  return <div className="content-stack owner-page owner-schools-page"><PageHeading eyebrow="УПРАВЛЕНИЕ ПРОЕКТОМ" title="Школы" detail="Список и настройки только школ вашего контура." action={<a className="text-button" href="/owner">Обзор проекта <ArrowRight size={15} /></a>} />
    <GlassCard className="owner-schools-card"><div className="section-card-heading"><div><span className="overline">ОРГАНИЗАЦИИ</span><h2>{schools.data!.length} {plural(schools.data!.length, "школа", "школы", "школ")}</h2></div><GlassButton variant="secondary" onClick={() => setShowCreate(!showCreate)}><Plus size={16} /> Создать школу</GlassButton></div>
      <div className="school-list-toolbar"><label className="search-box"><Search size={16} /><input aria-label="Поиск школ по названию или городу" placeholder="Название или город" value={query} onChange={(event) => setQuery(event.target.value)} /></label><label className="field"><span>Статус</span><select value={status} onChange={(event) => setStatus(event.target.value as "active" | "archived")}><option value="active">Активные</option><option value="archived">Архивные</option></select></label></div>
      {showCreate && <form className="owner-create-form" onSubmit={(event) => { event.preventDefault(); void act("/owner/schools", "POST", { ...schoolForm, requestKey: requestKey.current }).then((created) => { if (created) { requestKey.current = crypto.randomUUID(); setSchoolForm({ name: "", city: "", timezone: "Europe/Moscow" }); setShowCreate(false); setStatus("active"); } }); }}><GlassInput label="Название школы" required maxLength={150} value={schoolForm.name} onChange={(event) => setSchoolForm({ ...schoolForm, name: event.target.value })} /><GlassInput label="Город" required maxLength={100} value={schoolForm.city} onChange={(event) => setSchoolForm({ ...schoolForm, city: event.target.value })} /><GlassInput label="Часовой пояс" required maxLength={80} value={schoolForm.timezone} onChange={(event) => setSchoolForm({ ...schoolForm, timezone: event.target.value })} /><div className="owner-form-actions"><GlassButton type="submit" disabled={!schoolForm.name.trim() || !schoolForm.city.trim()}>Создать</GlassButton><GlassButton type="button" variant="secondary" onClick={() => setShowCreate(false)}>Отмена</GlassButton></div></form>}
      {schools.data!.length ? <div className="owner-school-list">{schools.data!.map((school: any) => <article className="owner-school-item" key={school.id}><div className="school-row"><span className="school-icon"><Home size={18} /></span><div><strong>{school.name}</strong><small>{school.city} · {school.timezone} · {school.activeClasses}/{school.classes} активных классов · {school.students} учеников · {school.administrators.length} администраторов</small></div><div className="owner-school-actions"><GlassButton variant="secondary" onClick={() => { const next = expandedSchool === school.id ? null : school.id; setExpandedSchool(next); setEditingSchool(null); }}>{expandedSchool === school.id ? "Закрыть" : "Открыть"}</GlassButton>{status === "active" ? <GlassButton variant="secondary" onClick={() => setEditingSchool({ id: school.id, name: school.name, city: school.city, timezone: school.timezone })}>Редактировать</GlassButton> : <GlassButton variant="secondary" onClick={() => void act(`/owner/schools/${school.id}/restore`)}>Восстановить</GlassButton>}{status === "active" && <GlassButton variant="secondary" onClick={() => setConfirm({ id: school.id, name: school.name, action: "archive" })}>В архив</GlassButton>}<GlassButton variant="danger" disabled={Boolean(school.classes || school.users || school.assignments || school.products)} title={school.classes || school.users || school.assignments || school.products ? "Школа содержит данные; удалите нельзя, используйте архив" : "Удалить пустую школу"} onClick={() => setConfirm({ id: school.id, name: school.name, action: "delete" })}>Удалить</GlassButton></div></div>
        {editingSchool?.id === school.id && <form className="owner-create-form" onSubmit={(event) => { event.preventDefault(); const current = editingSchool; if (!current) return; void act(`/owner/schools/${school.id}`, "PATCH", { name: current.name, city: current.city, timezone: current.timezone }).then((saved) => { if (saved) setEditingSchool(null); }); }}><GlassInput label="Название школы" required value={editingSchool?.name ?? ""} onChange={(event) => setEditingSchool((current) => current ? { ...current, name: event.target.value } : current)} /><GlassInput label="Город" required value={editingSchool?.city ?? ""} onChange={(event) => setEditingSchool((current) => current ? { ...current, city: event.target.value } : current)} /><GlassInput label="Часовой пояс" required value={editingSchool?.timezone ?? ""} onChange={(event) => setEditingSchool((current) => current ? { ...current, timezone: event.target.value } : current)} /><div className="owner-form-actions"><GlassButton type="submit">Сохранить изменения</GlassButton><GlassButton type="button" variant="secondary" onClick={() => setEditingSchool(null)}>Отмена</GlassButton></div></form>}
        {expandedSchool === school.id && <div className="owner-school-detail"><div className="school-facts"><span>Всего пользователей <strong>{school.users}</strong></span><span>Работ <strong>{school.assignments}</strong></span><span>Школьных товаров <strong>{school.products}</strong></span><span>Часовой пояс <strong>{school.timezone}</strong></span></div><div className="school-admins"><h3>Школьные администраторы</h3>{school.administrators.length ? school.administrators.map((admin: any) => <div className="class-person-row" key={admin.membershipId}><span>{admin.name}</span>{admin.manageable ? <button className="text-button" onClick={() => void act(`/owner/schools/${school.id}/admin`, "POST", { userId: admin.userId, enabled: false })}>Снять полномочия</button> : <small>Тестовая каноническая роль не меняется</small>}</div>) : <EmptyState title="Администраторы не назначены" detail="Выберите существующий допустимый аккаунт без активной принадлежности к другой школе." />}
            {ownerUsers.isLoading ? <LoadingState label="Ищем допустимые аккаунты" /> : ownerUsers.isError ? <ErrorState title="Не удалось загрузить аккаунты для назначения" detail={(ownerUsers.error as Error).message} retry={() => void ownerUsers.refetch()} /> : ownerUsers.data?.length ? <div className="owner-admin-assign-row"><label className="field"><span>Новый администратор</span><select aria-label={`Администратор для ${school.name}`} value={adminCandidates[school.id] ?? ""} onChange={(event) => setAdminCandidates({ ...adminCandidates, [school.id]: event.target.value })}><option value="">Выбрать пользователя</option>{ownerUsers.data.map((person: any) => <option value={person.id} key={person.id}>{person.name}{person.schoolName ? ` · ${person.schoolName}` : " · без школы"}</option>)}</select></label><GlassButton variant="secondary" disabled={!adminCandidates[school.id]} onClick={() => void act(`/owner/schools/${school.id}/admin`, "POST", { userId: adminCandidates[school.id], enabled: true })}>Назначить</GlassButton></div> : <p className="field-helper">Нет допустимых свободных аккаунтов. Пользователей, уже состоящих в другой школе, назначение не перемещает.</p>}</div></div>}
      </article>)}</div> : <EmptyState title={status === "archived" ? "Архивных школ пока нет" : "Школ пока нет"} detail={status === "archived" ? "Архивированные школы появятся здесь." : "Создайте школу, чтобы настроить классы и школьных администраторов."} />}
    </GlassCard>
    <GlassModal open={Boolean(confirm)} title={confirm?.action === "archive" ? "Архивировать школу?" : "Удалить пустую школу?"} onClose={() => setConfirm(null)}><div className="confirm-copy"><p>«{confirm?.name}».</p>{confirm?.action === "archive" ? <p>Архив закроет новые заявки и действия; незавершённые проверки сначала нужно завершить или передать. Данные останутся в базе.</p> : <p>Сервер разрешает физическое удаление только когда нет классов, пользователей, работ и товаров. Исторические данные не удаляются каскадом.</p>}</div><div className="modal-actions"><GlassButton variant="secondary" onClick={() => setConfirm(null)}>Отмена</GlassButton><GlassButton variant={confirm?.action === "delete" ? "danger" : "primary"} onClick={async () => { if (!confirm) return; const current = confirm; const saved = await act(current.action === "delete" ? `/owner/schools/${current.id}` : `/owner/schools/${current.id}/archive`, current.action === "delete" ? "DELETE" : "POST"); if (saved) { setConfirm(null); setExpandedSchool(null); } }}>{confirm?.action === "archive" ? "Подтвердить архив" : "Подтвердить удаление"}</GlassButton></div></GlassModal>
  </div>;
}

function OwnerUsersPage() {
  const [search, setSearch] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const schools = useQuery({ queryKey: ["owner-user-schools"], queryFn: () => api<any[]>("/owner/schools?status=active") });
  const users = useQuery({
    queryKey: ["owner-users", search, schoolId, role, status, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25", q: search, role, status });
      if (schoolId) params.set("schoolId", schoolId);
      return api<any>(`/owner/users?${params.toString()}`);
    },
  });
  if (schools.isLoading || users.isLoading) return <LoadingState label="Загружаем пользователей школ" />;
  if (schools.isError || users.isError) return <ErrorState title="Список пользователей недоступен" detail={(schools.error ?? users.error as Error)?.message} retry={() => { void schools.refetch(); void users.refetch(); }} />;
  const result = users.data;
  const roleLabel: Record<string, string> = { STUDENT: "Ученик", TEACHER: "Учитель", SCHOOL_ADMIN: "Администратор" };
  const statusLabel: Record<string, string> = { active: "Активен", pending: "Ожидает подтверждения", former: "Бывший участник", blocked: "Доступ закрыт" };
  return <div className="content-stack owner-page owner-users-page">
    <PageHeading eyebrow="УПРАВЛЕНИЕ ПРОЕКТОМ" title="Пользователи" detail="Участники школ проекта. Для каждой школы показана отдельная запись членства." action={<a className="text-button" href="/owner/schools">Школы <ArrowRight size={15} /></a>} />
    <GlassCard className="owner-users-card">
      <div className="owner-users-toolbar">
        <label className="search-box"><Search size={16} /><input aria-label="Найти пользователя по имени или фамилии" placeholder="Имя, фамилия или ФИО" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} /></label>
        <label className="field"><span>Школа</span><select value={schoolId} onChange={(event) => { setSchoolId(event.target.value); setPage(1); }}><option value="">Все школы</option>{(schools.data ?? []).map((school: any) => <option key={school.id} value={school.id}>{school.name}</option>)}</select></label>
        <label className="field"><span>Роль</span><select value={role} onChange={(event) => { setRole(event.target.value); setPage(1); }}><option value="all">Все роли</option><option value="student">Ученики</option><option value="teacher">Учителя</option><option value="admin">Администраторы</option></select></label>
        <label className="field"><span>Членство</span><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">Все</option><option value="active">Активные</option><option value="pending">Ожидают подтверждения</option><option value="former">Бывшие участники</option></select></label>
      </div>
      {users.isFetching && <p className="soft-text" role="status">Обновляем список…</p>}
      {result.items.length ? <>
        <div className="responsive-table owner-users-table"><table><thead><tr><th>Имя и фамилия</th><th>Школа</th><th>Класс</th><th>Роль</th><th>Состояние</th><th>Присоединился</th></tr></thead><tbody>{result.items.map((row: any) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.schoolName}</td><td>{row.className ?? "—"}</td><td><div className="owner-user-roles">{row.roles.map((item: string) => <span key={item}>{roleLabel[item] ?? item}</span>)}</div></td><td><span className={`owner-user-status is-${row.status}`}>{statusLabel[row.status] ?? row.status}</span></td><td>{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(row.joinedAt))}</td></tr>)}</tbody></table></div>
        <div className="owner-user-cards">{result.items.map((row: any) => <article className="owner-user-card" key={row.id}><div><strong>{row.name}</strong><span className={`owner-user-status is-${row.status}`}>{statusLabel[row.status] ?? row.status}</span></div><p>{row.schoolName}{row.className ? ` · ${row.className}` : ""}</p><div className="owner-user-roles">{row.roles.map((item: string) => <span key={item}>{roleLabel[item] ?? item}</span>)}</div><small>Присоединился {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(row.joinedAt))}</small></article>)}</div>
      </> : <EmptyState title="Пользователи не найдены" detail={search || schoolId || role !== "all" || status !== "all" ? "Измените поиск или фильтры." : "Подтверждённые участники появятся здесь после вступления в школу."} />}
      <div className="owner-users-pagination"><span>{result.total} записей · страница {result.page} из {result.pages}</span><div><GlassButton variant="secondary" disabled={page <= 1 || users.isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}><ArrowLeft size={15} /> Назад</GlassButton><GlassButton variant="secondary" disabled={page >= result.pages || users.isFetching} onClick={() => setPage((current) => current + 1)}>Дальше <ArrowRight size={15} /></GlassButton></div></div>
    </GlassCard>
  </div>;
}

function OwnerProductManager({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const products = useQuery({ queryKey: ["owner-products"], queryFn: () => api<any[]>("/owner/products") });
  const blankDraft = () => ({ name: "", description: "", category: "Стикеры", imageKey: "stickers", price: "25", stock: "10", perUserLimit: "1" });
  const [draft, setDraft] = useState(blankDraft);
  const [draftPhoto, setDraftPhoto] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(blankDraft);
  const [editingPhoto, setEditingPhoto] = useState<File | null>(null);
  const changed = () => { void client.invalidateQueries({ queryKey: ["owner-products"] }); void client.invalidateQueries({ queryKey: ["owner-overview"] }); void client.invalidateQueries({ queryKey: ["market"] }); };
  const uploadPhoto = async (id: string, photo: File) => { const form = new FormData(); form.append("photo", photo); await api(`/owner/products/${id}/image`, { method: "POST", body: form }); };
  const create = useMutation({ mutationFn: async () => { const product = await api<any>("/owner/products", { method: "POST", body: jsonBody({ ...draft, price: Number(draft.price), stock: Number(draft.stock), perUserLimit: Number(draft.perUserLimit) }) }); const photo = draftPhoto; setDraft(blankDraft()); setDraftPhoto(null); if (photo) await uploadPhoto(product.id, photo); return product; }, onSuccess: () => { toast.show("Товар добавлен в глобальный каталог"); changed(); }, onError: (error: Error) => { toast.show(error.message); changed(); } });
  const update = useMutation({ mutationFn: async ({ id, payload, photo }: { id: string; payload: Record<string, unknown>; photo?: File | null }) => { const product = await api<any>(`/owner/products/${id}`, { method: "PATCH", body: jsonBody(payload) }); if (photo) await uploadPhoto(id, photo); return product; }, onSuccess: () => { toast.show("Товар обновлён"); setEditingId(null); setEditingPhoto(null); changed(); }, onError: (error: Error) => { toast.show(error.message); changed(); } });
  if (products.isLoading) return <GlassCard><LoadingState label="Загружаем глобальный каталог" /></GlassCard>;
  if (products.isError) return <ErrorState title="Каталог владельца недоступен" detail={(products.error as Error).message} retry={() => void products.refetch()} />;
  const fields = (value: typeof draft, setValue: (next: typeof draft) => void, prefix: string) => <>
    <GlassInput label="Название" value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} required maxLength={120} />
    <label className="field"><span>Описание</span><textarea value={value.description} onChange={(event) => setValue({ ...value, description: event.target.value })} required maxLength={2000} /></label>
    <div className="owner-product-fields"><GlassInput label="Категория" value={value.category} onChange={(event) => setValue({ ...value, category: event.target.value })} required maxLength={80} /><label className="field"><span>Иконка товара</span><select value={value.imageKey} onChange={(event) => setValue({ ...value, imageKey: event.target.value })}>{!["gift", "stickers", "badge", "music", "book", "leaf"].includes(value.imageKey) && <option value={value.imageKey}>Текущая иконка</option>}<option value="gift">Подарок</option><option value="stickers">Стикеры</option><option value="badge">Значок</option><option value="music">Музыка</option><option value="book">Книга</option><option value="leaf">Природа</option></select></label><GlassInput label="Цена в Эйнштейнах" type="number" min={1} max={100000} value={value.price} onChange={(event) => setValue({ ...value, price: event.target.value })} required /><GlassInput label="Остаток" type="number" min={0} max={100000} value={value.stock} onChange={(event) => setValue({ ...value, stock: event.target.value })} required /><GlassInput label="Лимит на ученика" type="number" min={1} max={100} value={value.perUserLimit} onChange={(event) => setValue({ ...value, perUserLimit: event.target.value })} required /></div>
    <span className="sr-only">{prefix}</span>
  </>;
  return <GlassCard className="owner-product-manager"><div className="section-card-heading"><div><span className="overline">МАРКЕТ ВАЙБА</span><h2>Глобальные награды · {products.data!.length}</h2></div><Store size={18} /></div>
    <form className="owner-product-form" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>{fields(draft, setDraft, "Новый товар")}<label className="upload-drop product-photo-input"><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Добавить фото глобального товара" onChange={(event) => setDraftPhoto(event.currentTarget.files?.[0] ?? null)} /><span className="upload-icon"><Plus size={17} /></span><strong>{draftPhoto?.name ?? "Добавить фото товара"}</strong><small>JPEG, PNG или WebP · до 10 МБ</small></label><GlassButton type="submit" disabled={create.isPending || !draft.name.trim() || !draft.description.trim()}>{create.isPending ? "Добавляем…" : "Добавить награду"}</GlassButton></form>
    {products.data!.length ? <div className="owner-product-list">{products.data!.map((product: any) => <article className="owner-product-row" key={product.id}>
      <div className="owner-product-heading"><div className={`product-art art-${product.imageKey}`}>{product.imageUrl ? <img src={product.imageUrl} alt={`Фото товара «${product.name}»`} /> : <span className="product-art-icon">{productIcon(product.imageKey)}</span>}</div><div><strong>{product.name}</strong><small>{product.category} · {product.price} Э · остаток {product.stock} · лимит {product.perUserLimit}{product.active ? " · активен" : " · архивирован"}</small></div><div className="owner-product-actions"><GlassButton variant="secondary" onClick={() => { setEditingId(editingId === product.id ? null : product.id); setEditing({ name: product.name, description: product.description, category: product.category, imageKey: product.imageKey, price: String(product.price), stock: String(product.stock), perUserLimit: String(product.perUserLimit) }); setEditingPhoto(null); }}>{editingId === product.id ? "Закрыть" : "Редактировать"}</GlassButton><GlassButton variant="secondary" disabled={update.isPending} onClick={() => update.mutate({ id: product.id, payload: { active: !product.active } })}>{product.active ? "Скрыть" : "Вернуть"}</GlassButton></div></div>
      {editingId === product.id && <form className="owner-product-edit" onSubmit={(event) => { event.preventDefault(); update.mutate({ id: product.id, payload: { ...editing, price: Number(editing.price), stock: Number(editing.stock), perUserLimit: Number(editing.perUserLimit) }, photo: editingPhoto }); }}>{fields(editing, setEditing, `Изменить ${product.name}`)}<label className="upload-drop product-photo-input"><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Заменить фото товара ${product.name}`} onChange={(event) => setEditingPhoto(event.currentTarget.files?.[0] ?? null)} /><span className="upload-icon"><Plus size={17} /></span><strong>{editingPhoto?.name ?? (product.imageUrl ? "Заменить фото товара" : "Добавить фото товара")}</strong><small>JPEG, PNG или WebP · до 10 МБ</small></label><div className="owner-form-actions"><GlassButton type="submit" disabled={update.isPending || !editing.name.trim() || !editing.description.trim()}>Сохранить</GlassButton><GlassButton type="button" variant="secondary" onClick={() => { setEditingId(null); setEditingPhoto(null); }}>Отмена</GlassButton></div></form>}
    </article>)}</div> : <EmptyState title="В глобальном каталоге пока пусто" detail="Первая награда появится после заполнения формы." />}
    <p className="soft-footnote">Заказы сохраняют снимок цены и названия. Архивирование скрывает новый товар и не удаляет историю.</p>
  </GlassCard>;
}

function SchoolProductManager({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const products = useQuery({ queryKey: ["admin-products"], queryFn: () => api<any[]>("/admin/products") });
  const blank = () => ({ name: "", description: "", category: "Школьная жизнь", imageKey: "gift", price: "5", stock: "10", perUserLimit: "1" });
  const [draft, setDraft] = useState(blank);
  const [draftPhoto, setDraftPhoto] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(blank);
  const [editingPhoto, setEditingPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => { void client.invalidateQueries({ queryKey: ["admin-products"] }); void client.invalidateQueries({ queryKey: ["market"] }); };
  const uploadPhoto = async (id: string, file: File) => { const form = new FormData(); form.append("photo", file); await api(`/admin/products/${id}/image`, { method: "POST", body: form }); };
  const createProduct = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { const product = await api<any>("/admin/products", { method: "POST", body: jsonBody({ ...draft, price: Number(draft.price), stock: Number(draft.stock), perUserLimit: Number(draft.perUserLimit) }) }); const photo = draftPhoto; setDraft(blank()); setDraftPhoto(null); if (photo) await uploadPhoto(product.id, photo); toast.show("Товар добавлен в школьный маркет"); refresh(); }
    catch (error) { toast.show((error as Error).message); refresh(); }
    finally { setBusy(false); }
  };
  const saveProduct = async (event: React.FormEvent, id: string) => {
    event.preventDefault(); setBusy(true);
    try { await api(`/admin/products/${id}`, { method: "PATCH", body: jsonBody({ ...editing, price: Number(editing.price), stock: Number(editing.stock), perUserLimit: Number(editing.perUserLimit) }) }); if (editingPhoto) await uploadPhoto(id, editingPhoto); toast.show("Школьный товар обновлён"); setEditingId(null); setEditingPhoto(null); refresh(); }
    catch (error) { toast.show((error as Error).message); refresh(); }
    finally { setBusy(false); }
  };
  const toggle = async (product: any) => { try { await api(`/admin/products/${product.id}`, { method: "PATCH", body: jsonBody({ active: !product.active }) }); toast.show(product.active ? "Товар скрыт" : "Товар возвращён в каталог"); refresh(); } catch (error) { toast.show((error as Error).message); } };
  if (products.isLoading) return <GlassCard><LoadingState label="Загружаем школьный маркет" /></GlassCard>;
  if (products.isError) return <ErrorState title="Школьный маркет недоступен" detail={(products.error as Error).message} retry={() => void products.refetch()} />;
  const fields = (value: ReturnType<typeof blank>, setValue: (next: ReturnType<typeof blank>) => void) => <>
    <GlassInput label="Название товара" value={value.name} onChange={(event) => setValue({ ...value, name: event.target.value })} required maxLength={120} />
    <label className="field"><span>Описание и условие выдачи</span><textarea value={value.description} onChange={(event) => setValue({ ...value, description: event.target.value })} required maxLength={2000} /></label>
    <div className="owner-product-fields"><GlassInput label="Категория" value={value.category} onChange={(event) => setValue({ ...value, category: event.target.value })} required maxLength={80} /><label className="field"><span>Иконка товара</span><select value={value.imageKey} onChange={(event) => setValue({ ...value, imageKey: event.target.value })}>{!["gift", "stickers", "badge", "music", "book", "leaf"].includes(value.imageKey) && <option value={value.imageKey}>Текущая иконка</option>}<option value="gift">Подарок</option><option value="stickers">Стикеры</option><option value="badge">Значок</option><option value="music">Музыка</option><option value="book">Книга</option><option value="leaf">Природа</option></select></label><GlassInput label="Цена в Эйнштейнах" type="number" min={1} max={100000} value={value.price} onChange={(event) => setValue({ ...value, price: event.target.value })} required /><GlassInput label="Остаток" type="number" min={0} max={100000} value={value.stock} onChange={(event) => setValue({ ...value, stock: event.target.value })} required /><GlassInput label="Лимит на ученика" type="number" min={1} max={100} value={value.perUserLimit} onChange={(event) => setValue({ ...value, perUserLimit: event.target.value })} required /></div>
  </>;
  return <GlassCard className="owner-product-manager"><div className="section-card-heading"><div><span className="overline">НАГРАДЫ ШКОЛЫ</span><h2>Школьный маркет · {products.data!.length}</h2></div><Store size={18} /></div>
    <form className="owner-product-form" onSubmit={(event) => void createProduct(event)}>{fields(draft, setDraft)}<label className="upload-drop product-photo-input"><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Добавить фото школьного товара" onChange={(event) => setDraftPhoto(event.currentTarget.files?.[0] ?? null)} /><span className="upload-icon"><Plus size={17} /></span><strong>{draftPhoto?.name ?? "Добавить фото товара"}</strong><small>JPEG, PNG или WebP · до 10 МБ</small></label><GlassButton type="submit" disabled={busy || !draft.name.trim() || !draft.description.trim()}>{busy ? "Сохраняем…" : "Добавить награду"}</GlassButton></form>
    {products.data!.length ? <div className="owner-product-list">{products.data!.map((product: any) => <article className="owner-product-row" key={product.id}><div className="owner-product-heading"><div className={`product-art art-${product.imageKey}`}>{product.imageUrl ? <img src={product.imageUrl} alt={`Фото товара «${product.name}»`} /> : <span className="product-art-icon">{productIcon(product.imageKey)}</span>}</div><div><strong>{product.name}</strong><small>{product.category} · {product.price} Э · остаток {product.stock} · заказов {product.orderCount}{product.active ? " · активен" : " · архивирован"}</small></div><div className="owner-product-actions"><GlassButton variant="secondary" onClick={() => { setEditingId(editingId === product.id ? null : product.id); setEditing({ name: product.name, description: product.description, category: product.category, imageKey: product.imageKey, price: String(product.price), stock: String(product.stock), perUserLimit: String(product.perUserLimit) }); setEditingPhoto(null); }}>{editingId === product.id ? "Закрыть" : "Изменить"}</GlassButton><GlassButton variant="secondary" disabled={busy} onClick={() => void toggle(product)}>{product.active ? "Скрыть" : "Вернуть"}</GlassButton></div></div>
      {editingId === product.id && <form className="owner-product-edit" onSubmit={(event) => void saveProduct(event, product.id)}>{fields(editing, setEditing)}<label className="upload-drop product-photo-input"><input type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Заменить фото товара ${product.name}`} onChange={(event) => setEditingPhoto(event.currentTarget.files?.[0] ?? null)} /><span className="upload-icon"><Plus size={17} /></span><strong>{editingPhoto?.name ?? (product.imageUrl ? "Заменить фото товара" : "Добавить фото товара")}</strong><small>JPEG, PNG или WebP · до 10 МБ</small></label><div className="owner-form-actions"><GlassButton type="submit" disabled={busy || !editing.name.trim() || !editing.description.trim()}>Сохранить</GlassButton><GlassButton type="button" variant="secondary" onClick={() => { setEditingId(null); setEditingPhoto(null); }}>Отмена</GlassButton></div></form>}</article>)}</div> : <EmptyState title="В школьном маркете пока пусто" detail="Добавьте школьную награду, чтобы ученики могли её увидеть." />}
    <p className="soft-footnote">Архивирование скрывает товар для новых заказов. История оформленных заказов сохраняется.</p>
  </GlassCard>;
}

function OwnerPage({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const [targetSchool, setTargetSchool] = useState("");
  const [adminUser, setAdminUser] = useState("");
  const overview = useQuery({ queryKey: ["owner-overview"], queryFn: () => api<any>("/owner/overview") });
  const globalOrders = useQuery({ queryKey: ["owner-global-orders"], queryFn: () => api<any[]>("/admin/orders") });
  const ownerUsersQuery = useQuery({ queryKey: ["owner-admin-candidates", targetSchool], queryFn: () => api<any[]>(`/owner/users?scope=candidates&schoolId=${encodeURIComponent(targetSchool)}`), enabled: Boolean(targetSchool), retry: false });
  const act = async (url: string, body: unknown): Promise<boolean> => { try { await api(url, { method: "POST", body: jsonBody(body) }); toast.show("Изменение сохранено"); void client.invalidateQueries({ queryKey: ["owner-overview"] }); void client.invalidateQueries({ queryKey: ["owner-schools"] }); void client.invalidateQueries({ queryKey: ["owner-admin-candidates"] }); void client.invalidateQueries({ queryKey: ["owner-users"] }); void client.invalidateQueries({ queryKey: ["owner-global-orders"] }); return true; } catch (error) { toast.show((error as Error).message); return false; } };
  if (overview.isLoading) return <LoadingState label="Открываем панель владельца" />;
  if (overview.isError) return <ErrorState title="Панель владельца недоступна" detail={(overview.error as Error).message} retry={() => void overview.refetch()} />;
  const ownerUsers = ownerUsersQuery.data ?? [];
  return <div className="content-stack owner-page"><PageHeading eyebrow="УПРАВЛЕНИЕ ПРОЕКТОМ" title="Владелец Вайба" detail="Школы, общий каталог и агрегированное состояние проекта." action={<span className="owner-only-chip"><ShieldCheck size={16} /> роль владельца</span>} />
    <div className="owner-legal-partner-links"><a href="/owner/legal"><span><ShieldCheck size={20} /></span><div><strong>Юридическая информация</strong><small>Реквизиты, контакты и список незаполненных сведений</small></div><ArrowRight size={18} /></a><a href="/owner/partners"><span><Users size={20} /></span><div><strong>Сотрудничество</strong><small>Создание и публикация карточек организаций</small></div><ArrowRight size={18} /></a><a href="/owner/faq"><span><CircleHelp size={20} /></span><div><strong>Редактор вопросов</strong><small>Проверенные ответы, публикация и сортировка</small></div><ArrowRight size={18} /></a></div>
    <div className="admin-kpi-grid"><StatTile icon={<Home size={18} />} label="Школы" value={overview.data.schools.length} detail="изолированные пространства" /><StatTile icon={<Palette size={18} />} label="Оформлений" value={overview.data.cosmeticCount} detail="встроенный каталог" /><StatTile icon={<Store size={18} />} label="Глобальный каталог" value={overview.data.globalProducts} detail={`${overview.data.pendingOrders} заказов ждут выдачи`} /></div>
    <GlassCard className="owner-schools-card"><div className="section-card-heading"><div><span className="overline">ОРГАНИЗАЦИИ</span><h2>Школы проекта</h2></div><a className="text-button" href="/owner/schools">Управлять списком школ <ArrowRight size={15} /></a></div>{overview.data.schools.length ? overview.data.schools.map((school: any) => <div className="school-row" key={school.id}><span className="school-icon"><Home size={18} /></span><div><strong>{school.name}</strong><small>{school.city} · {school.timezone} · {school.students} подтверждённых учеников · {school.assignments} работ</small></div><button className="text-button" onClick={() => { setTargetSchool(school.id); document.getElementById("admin-assign-form")?.scrollIntoView({ behavior: "smooth" }); }}>Назначить администратора <ArrowRight size={15} /></button></div>) : <EmptyState title="Школ пока нет" detail="Создайте первую школу в разделе «Школы»." />}</GlassCard>
    <div className="owner-tools-grid"><GlassCard id="admin-assign-form"><div className="section-card-heading"><div><span className="overline">ПРАВА ШКОЛЫ</span><h2>Назначить администратора</h2></div><Users size={18} /></div><p className="soft-text">Школьного администратора назначает только владелец. Роль не повышается через регистрацию.</p><label className="field"><span>Школа</span><select value={targetSchool} onChange={(event) => setTargetSchool(event.target.value)}><option value="">Выбрать школу</option>{overview.data.schools.map((school: any) => <option value={school.id} key={school.id}>{school.name}</option>)}</select></label><label className="field"><span>Учётная запись пользователя</span><select value={adminUser} onChange={(event) => setAdminUser(event.target.value)}><option value="">Выбрать аккаунт</option>{ownerUsers.map((person: any) => <option value={person.id} key={person.id}>{person.name}{person.schoolName ? ` · ${person.schoolName}` : ""}</option>)}</select></label><GlassButton disabled={!targetSchool || !adminUser} onClick={() => void act(`/owner/schools/${targetSchool}/admin`, { userId: adminUser })}>Назначить роль</GlassButton></GlassCard>
      <OwnerProductManager toast={toast} /></div>
    <GlassCard className="admin-orders-card owner-orders-card"><div className="section-card-heading"><div><span className="overline">МАРКЕТ ВАЙБА</span><h2>Глобальные заказы</h2></div><PackageCheck size={18} /></div>{globalOrders.isLoading ? <LoadingState label="Загружаем заказы глобального маркета" /> : globalOrders.isError ? <ErrorState title="Заказы глобального маркета недоступны" detail={(globalOrders.error as Error).message} retry={() => void globalOrders.refetch()} /> : globalOrders.data!.length ? <div className="orders-list">{globalOrders.data!.map((order: any) => <div className="order-row" key={order.id}><span className="order-art art-book">◇</span><div><strong>{order.name}</strong><small>{order.student.name} · код {order.code} · {order.price} Э</small></div><StatusBadge status={order.status} />{order.status === "RESERVED" && <GlassButton variant="secondary" onClick={() => void act(`/admin/orders/${order.id}/fulfill`, {})}>Подтвердить выдачу</GlassButton>}</div>)}</div> : <EmptyState title="Глобальных заказов пока нет" detail="Заказы на награды Вайба появятся после покупки учеником." />}</GlassCard>
    
  </div>;
}

function OnboardingPage({ toast }: { toast: ToastHook }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["onboarding"], queryFn: () => api<any>("/onboarding/options") });
  const [schoolId, setSchoolId] = useState("");
  const [classId, setClassId] = useState("");
  const [editingPending, setEditingPending] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const join = useMutation({ mutationFn: () => api<any>("/onboarding/request", { method: "POST", body: jsonBody({ schoolId, classId, firstName, lastName }) }), onSuccess: (data) => { setEditingPending(false); toast.show(`Заявка отправлена в ${data.school}`); void client.invalidateQueries({ queryKey: ["onboarding"] }); void client.invalidateQueries({ queryKey: ["session"] }); }, onError: (error: Error) => toast.show(error.message) });
  if (query.isLoading) return <LoadingState />;
  if (query.isError) return <ErrorState detail={(query.error as Error).message} retry={() => void query.refetch()} />;
  const schools = query.data.schools as Array<{ id: string; name: string; city: string; classes: Array<{ id: string; name: string }> }>;
  const selectedSchool = schools.find((school) => school.id === schoolId);
  return <div className="content-stack onboarding-page"><PageHeading eyebrow="ПЕРВЫЙ ШАГ" title="Присоединиться к школе" detail="Выбери школу и класс. Администратор подтвердит заявку." /><GlassCard className="onboarding-card"><div className="onboarding-illustration"><span className="onboarding-orb"><Users size={28} /></span><h2>Здесь начинается<br />твой путь</h2><p>Вайб не создаёт школы по свободному названию. Доступ появится после подтверждения.</p></div>{query.data.pending && !editingPending ? <div className="request-waiting"><Clock3 size={19} /><strong>Заявка в «{query.data.pending.school}» ожидает подтверждения.</strong><p>Школьные задания и данные откроются после решения администратора.</p><GlassButton variant="secondary" onClick={() => { setSchoolId(query.data.pending.schoolId); setClassId(query.data.pending.classId ?? ""); setEditingPending(true); }}>Изменить класс</GlassButton></div> : <form className="onboarding-form" onSubmit={(event) => { event.preventDefault(); join.mutate(); }}><div className="form-row"><GlassInput label="Имя" required value={firstName} onChange={(event) => setFirstName(event.target.value)} /><GlassInput label="Фамилия" required value={lastName} onChange={(event) => setLastName(event.target.value)} /></div><label className="field"><span>Школа</span><select required disabled={Boolean(query.data.pending && editingPending)} value={schoolId} onChange={(event) => { setSchoolId(event.target.value); setClassId(""); }}><option value="">Выбрать школу</option>{schools.map((school) => <option value={school.id} key={school.id}>{school.name} · {school.city}</option>)}</select></label><label className="field"><span>Класс</span><select required disabled={!selectedSchool || selectedSchool.classes.length === 0} value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">{!selectedSchool ? "Сначала выберите школу" : selectedSchool.classes.length ? "Выбрать класс" : "В этой школе пока нет классов"}</option>{selectedSchool?.classes.map((schoolClass) => <option key={schoolClass.id} value={schoolClass.id}>{schoolClass.name}</option>)}</select></label><GlassButton type="submit" disabled={join.isPending || !schoolId || !classId}>{join.isPending ? "Отправляем…" : "Отправить заявку"}<ArrowRight size={16} /></GlassButton></form>}</GlassCard></div>;
}

function StatTile({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string | number; detail: string }) { return <GlassCard className="stat-tile"><span className="stat-icon">{icon}</span><span className="overline">{label}</span><strong>{value}</strong><small>{detail}</small></GlassCard>; }

function categoryIcon(category: string) { const map: Record<string, string> = { "Учёба": "Aa", "Творчество": "✦", "Спорт": "↗", "Волонтёрство": "♡", "Школьная жизнь": "⌂" }; return map[category] ?? "•"; }
function categorySlug(category: string) { return ({ "Учёба": "study", "Творчество": "art", "Спорт": "sport", "Волонтёрство": "volunteer", "Школьная жизнь": "school" } as Record<string, string>)[category] ?? "study"; }
function plural(value: number, one: string, few: string, many: string) { const n = Math.abs(value) % 100; const last = n % 10; return n > 10 && n < 20 ? many : last > 1 && last < 5 ? few : last === 1 ? one : many; }
function formatDayKeys(days: string[] = []) { return days.map((day) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(new Date(`${day}T12:00:00Z`))).join(", "); }
function formatSeconds(value: number) { return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`; }
function productIcon(key: string) { return ({ stickers: "✦", badge: "◉", music: "♫", book: "▤", leaf: "❧", gift: "✧" } as Record<string, string>)[key] ?? "◇"; }

export function App() {
  const toast = useToast();
  const theme = useThemeMode();
  const [path, setPath] = useState(() => window.location.pathname === "/owner/max" ? "/owner" : window.location.pathname);
  useEffect(() => {
    if (window.location.pathname === "/owner/max") window.history.replaceState({}, "", "/owner");
    const routeRoots = ["/tasks", "/profile", "/market", "/about", "/partners", "/faq", "/documents", "/reviews", "/teacher", "/admin", "/owner", "/onboarding", "/legal"];
    const isAppRoute = (pathname: string) => pathname === "/" || routeRoots.some((root) => pathname === root || pathname.startsWith(root + "/"));
    const syncPath = () => {
      if (window.location.pathname === "/owner/max") {
        window.history.replaceState({}, "", "/owner");
        setPath("/owner");
      } else setPath(window.location.pathname);
    };
    const onInternalLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.hasAttribute("download") || (link.target && link.target.toLowerCase() !== "_self") || link.relList.contains("external")) return;
      const next = new URL(link.href, window.location.href);
      if (next.origin !== window.location.origin || !isAppRoute(next.pathname)) return;
      if (next.pathname === window.location.pathname && next.search === window.location.search) {
        if (next.hash !== window.location.hash) return;
        event.preventDefault();
        return;
      }
      event.preventDefault();
      const nextPath = next.pathname === "/owner/max" ? "/owner" : next.pathname;
      window.history.pushState({}, "", nextPath + next.search + next.hash);
      setPath(nextPath);
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    };
    document.addEventListener("click", onInternalLink);
    window.addEventListener("popstate", syncPath);
    return () => {
      document.removeEventListener("click", onInternalLink);
      window.removeEventListener("popstate", syncPath);
    };
  }, []);
  const maxBridge = (window as Window & { WebApp?: MaxBridge }).WebApp;
  const maxLaunchPathFromMenu = maxLaunchPath(maxBridge?.initDataUnsafe?.start_param ?? "");
  useEffect(() => {
    if (!maxBridge?.initData || !maxLaunchPathFromMenu) return;
    const pathname = maxLaunchPathFromMenu.split("#", 1)[0] ?? "/tasks";
    if (window.location.pathname !== pathname || window.location.hash !== (maxLaunchPathFromMenu.includes("#") ? `#${maxLaunchPathFromMenu.split("#")[1]}` : "")) {
      window.history.replaceState({}, "", maxLaunchPathFromMenu);
      setPath(pathname);
      window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
  }, [Boolean(maxBridge?.initData), maxLaunchPathFromMenu]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("max-mini-app", Boolean(maxBridge?.initData));
    return () => root.classList.remove("max-mini-app");
  }, [maxBridge, Boolean(maxBridge?.initData)]);
  useEffect(() => {
    if (!maxBridge) return;
    if (maxBridge.initData) {
      maxBridge.ready?.();
      maxBridge.expand?.();
    }
    if (!maxBridge.getViewportSize) return;
    let mounted = true;
    let requestId = 0;
    const syncViewport = () => {
      const currentRequest = ++requestId;
      void maxBridge.getViewportSize!.call(maxBridge).then(({ height }) => {
        const viewportHeight = Number.parseFloat(height);
        if (!mounted || currentRequest !== requestId || !Number.isFinite(viewportHeight) || viewportHeight < 1 || viewportHeight > 10000) return;
        document.documentElement.style.setProperty("--max-app-viewport-height", `${viewportHeight}px`);
      }).catch(() => undefined);
    };
    syncViewport();
    window.addEventListener("resize", syncViewport, { passive: true });
    window.addEventListener("orientationchange", syncViewport, { passive: true });
    window.visualViewport?.addEventListener("resize", syncViewport, { passive: true });
    return () => {
      mounted = false;
      requestId += 1;
      window.removeEventListener("resize", syncViewport);
      window.removeEventListener("orientationchange", syncViewport);
      window.visualViewport?.removeEventListener("resize", syncViewport);
      document.documentElement.style.removeProperty("--max-app-viewport-height");
    };
  }, [maxBridge, Boolean(maxBridge?.initData)]);
  useEffect(() => {
    const back = maxBridge?.BackButton;
    if (!back || !maxBridge?.initData) return;
    if (path === "/" || path === "/tasks") { back.hide(); return; }
    const onBack = () => { if (window.history.length > 1) window.history.back(); else window.location.assign("/tasks"); };
    back.show(); back.onClick(onBack);
    return () => { back.offClick(onBack); back.hide(); };
  }, [path, Boolean(maxBridge?.initData)]);
  const publicLegalRoute = path.startsWith("/legal");
  const publicPartnersRoute = path === "/partners";
  const publicFaqRoute = path === "/faq";
  const publicDocumentsRoute = path === "/documents";
  const publicReviewsRoute = path === "/reviews";
  const query = useQuery({ queryKey: ["session"], queryFn: () => api<SessionResponse>("/session/me"), retry: false, enabled: !publicLegalRoute && !publicPartnersRoute && !publicFaqRoute });
  if (publicLegalRoute) return <LegalSite pathname={path} authenticated={Boolean(query.data?.authenticated && query.data?.user)} />;
  if (publicPartnersRoute) return <div className="legal-site cooperation-public-site"><header className="legal-site-header"><a className="brand-lockup" href="/"><img className="brand-image" src="/brand/vibe-logo.png" alt="Вайб" /><small>школьная жизнь интереснее</small></a><a className="legal-back-link" href="/">Вернуться в сервис</a></header><main className="legal-main cooperation-public-main"><PartnersPage toast={toast} /></main><LegalFooter className="legal-site-footer" /></div>;
  if (publicFaqRoute) return <div className="legal-site cooperation-public-site"><header className="legal-site-header"><a className="brand-lockup" href="/"><img className="brand-image" src="/brand/vibe-logo.png" alt="Вайб" /><small>школьная жизнь интереснее</small></a><a className="legal-back-link" href="/">Вернуться в сервис</a></header><main className="legal-main cooperation-public-main"><FaqPage /></main><LegalFooter className="legal-site-footer" /></div>;
  if (publicDocumentsRoute) return <div className="legal-site cooperation-public-site"><header className="legal-site-header"><a className="brand-lockup" href="/"><img className="brand-image" src="/brand/vibe-logo.png" alt="Вайб" /><small>школьная жизнь интереснее</small></a><a className="legal-back-link" href="/">Вернуться в сервис</a></header><main className="legal-main cooperation-public-main"><DocumentsPage user={query.data?.authenticated ? query.data.user ?? null : null} toast={toast.show} /></main><LegalFooter className="legal-site-footer" /></div>;
  if (publicReviewsRoute) return <div className="legal-site cooperation-public-site"><header className="legal-site-header"><a className="brand-lockup" href="/"><img className="brand-image" src="/brand/vibe-logo.png" alt="Вайб" /><small>школьная жизнь интереснее</small></a><a className="legal-back-link" href="/">Вернуться в сервис</a></header><main className="legal-main cooperation-public-main"><ReviewsPage user={query.data?.authenticated ? query.data.user ?? null : null} toast={toast.show} /></main><LegalFooter className="legal-site-footer" /></div>;
  if (query.isLoading) return <div className="app-loading"><span className="brand-orb"><img src="/brand/vibe-logo.png" alt="" /></span><span>Вайб открывается…</span></div>;
  if (query.isError) return <div className="app-loading"><ErrorState title="Не удалось загрузить страницу" detail="Проверьте подключение и попробуйте ещё раз." retry={() => void query.refetch()} /></div>;
  if (!query.data) return <LoadingState label="Загружаем профиль" />;
  if (!query.data.authenticated || !query.data.user) return <LoginScreen toast={toast} />;
  const user = query.data.user;
  const taskId = path.match(/^\/tasks\/([^/]+)/u)?.[1];
  let content: React.ReactNode;
  const active = path === "/about" ? "about" : path.startsWith("/partners") ? "partners" : path.startsWith("/faq") ? "faq" : path.startsWith("/documents") ? "documents" : path.startsWith("/reviews") ? "reviews" : path.startsWith("/tasks") ? "tasks" : path.startsWith("/profile/customize") ? "customize" : path.startsWith("/profile") ? "profile" : path.startsWith("/market") ? "market" : path.startsWith("/teacher") ? "teacher" : path.startsWith("/admin") ? "admin" : path.startsWith("/owner") ? "owner" : path.startsWith("/onboarding") ? "onboarding" : "tasks";
  if (taskId) content = <TaskPage assignmentId={decodeURIComponent(taskId)} toast={toast} />;
  else if (path === "/profile/customize") content = <CustomizePage user={user} toast={toast} />;
  else if (path === "/about") content = <AboutPage user={user} toast={toast} />;
  else if (path === "/partners") content = <PartnersPage toast={toast} />;
  else if (path === "/documents") content = <DocumentsPage user={user} toast={toast.show} />;
  else if (path === "/reviews") content = <ReviewsPage user={user} toast={toast.show} />;
  else if (path === "/profile") content = <ProfilePage user={user} toast={toast} />;
  else if (path === "/market") content = <MarketPage toast={toast} />;
  else if (path === "/teacher") content = <TeacherPage toast={toast} />;
  else if (path === "/admin") content = <AdminPage toast={toast} />;
  else if (path === "/owner/schools") content = user.role === "PROJECT_OWNER" ? <OwnerSchoolsPage toast={toast} /> : <ErrorState title="Нет доступа" detail="Эта страница доступна владельцу проекта." />;
  else if (path === "/owner/users") content = user.role === "PROJECT_OWNER" ? <OwnerUsersPage /> : <ErrorState title="Нет доступа" detail="Эта страница доступна владельцу проекта." />;
  else if (path === "/owner/legal") content = user.role === "PROJECT_OWNER" ? <OwnerLegalSettingsPage toast={toast} /> : <ErrorState title="Нет доступа" detail="Эта страница доступна владельцу проекта." />;
  else if (path === "/owner/partners") content = user.role === "PROJECT_OWNER" ? <OwnerPartnersPage toast={toast} /> : <ErrorState title="Нет доступа" detail="Эта страница доступна владельцу проекта." />;
  else if (path === "/owner/faq") content = user.role === "PROJECT_OWNER" ? <OwnerFaqPage onMessage={toast.show} /> : <ErrorState title="Нет доступа" detail="Редактирование вопросов доступно только владельцу проекта." />;
  else if (path === "/owner") content = <OwnerPage toast={toast} />;
  else if (path === "/onboarding") content = <OnboardingPage toast={toast} />;
  else content = <TasksPage />;
  return <AppShell user={user} active={active} toast={toast} preferences={user.preferences} themeMode={theme.mode} onThemeModeChange={theme.choose}><LegalAcceptanceGate onMessage={toast.show}>{content}</LegalAcceptanceGate></AppShell>;
}
