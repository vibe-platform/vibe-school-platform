import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Copy, Download, FileText, ShieldCheck } from "lucide-react";
import { api, jsonBody } from "./api";

type LegalFieldKey =
  | "organizationFullName" | "organizationShortName" | "legalAddress" | "location" | "inn" | "ogrn"
  | "generalEmail" | "privacyEmail" | "domain" | "hostingProvider" | "serverLocation";
type PublicLegalSettings = Record<LegalFieldKey, string | null> & { privacyVersion: string | null; termsVersion: string | null; consentVersion: string | null };
type LegalSection = { id: string; title: string; paragraphs?: string[]; bullets?: string[]; fields?: Array<{ key: LegalFieldKey; label: string }> };
type LegalDocument = { title: string; version: string; sections: LegalSection[] };
const operatorFields: Array<{ key: LegalFieldKey; label: string }> = [
  { key: "organizationFullName", label: "Полное наименование" },
  { key: "organizationShortName", label: "Краткое наименование" },
  { key: "location", label: "Место нахождения" },
  { key: "legalAddress", label: "Адрес" },
  { key: "inn", label: "ИНН" },
  { key: "ogrn", label: "ОГРН" },
  { key: "domain", label: "Сайт" },
  { key: "generalEmail", label: "Общие обращения" },
  { key: "privacyEmail", label: "Вопросы персональных данных" },
];
const documents: Record<string, LegalDocument> = {
  "/legal/terms": {
    title: "Пользовательское соглашение",
    version: "1.1 · 01.11.2026",
    sections: [
      { id: "scope", title: "1. Сервис", paragraphs: ["«Вайб» помогает школьникам выполнять задания, получать обратную связь, следить за личным прогрессом и выбирать награды. Доступные функции зависят от настроек школы.", "Настоящее соглашение описывает правила использования сервиса. Порядок работы с персональными данными изложен в отдельной Политике обработки персональных данных."] },
      { id: "account", title: "2. Учётная запись", paragraphs: ["Пользователь входит в сервис через доступный способ авторизации и использует назначенную ему учётную запись. Права ученика, учителя, школьного администратора и владельца проекта различаются.", "Не передавайте доступ к своей учётной записи другим людям. Если возникла проблема со входом или отображением данных, обратитесь к школе или владельцу сервиса."] },
      { id: "learning", title: "3. Задания и ответы", paragraphs: ["Учителя размещают задания и проверяют ответы учеников. В зависимости от задания ответ может содержать текст или фотографию решения. Ученик видит собственные задания, оценки и комментарии.", "Пользователь размещает материалы, необходимые для учебной работы, и не загружает сведения, которые не относятся к заданию или не должны быть доступны другим участникам."] },
      { id: "progress", title: "4. Прогресс и награды", paragraphs: ["Баллы опыта, уровни, достижения и «Эйнштейны» показывают прогресс внутри сервиса. «Эйнштейны» не являются деньгами или платёжным средством, не продаются за рубли и не переводятся между пользователями.", "Награды доступны внутри сервиса. Если награда предполагает выдачу школой, её порядок определяет школа и он показывается в карточке награды."] },
      { id: "content", title: "5. Материалы и общение", paragraphs: ["Пользователь отвечает за содержание отправленных материалов и должен уважать права других людей. Не загружайте чужие фотографии без разрешения, незаконные материалы и файлы, которые могут нарушить работу сервиса.", "Владелец сервиса или школа могут скрыть материал, если это необходимо для безопасности пользователей или работы платформы."] },
      { id: "availability", title: "6. Работа сервиса", paragraphs: ["Отдельные функции могут обновляться или временно быть недоступны. Сервис не гарантирует конкретный учебный результат или выдачу материальной награды.", "Актуальная редакция соглашения доступна в разделе правовой информации."] },
      { id: "contacts", title: "7. Контакты", paragraphs: ["Сведения о владельце сервиса и способы связи размещены в разделе «Сведения о владельце сайта»."] },
    ],
  },
  "/legal/privacy": {
    title: "Политика обработки персональных данных",
    version: "2.0 · 01.11.2026",
    sections: [
      { id: "operator", title: "1. Оператор и контакт", paragraphs: ["Оператор персональных данных — владелец сервиса «Вайб». Его наименование, адрес и реквизиты указаны в разделе «Сведения о владельце сайта». По вопросам обработки данных можно написать на vaibe32@mail.ru."], fields: operatorFields },
      { id: "data", title: "2. Какие данные обрабатываются", paragraphs: ["Состав данных зависит от использования сервиса. «Вайб» обрабатывает только сведения, необходимые для перечисленных в этой Политике целей:"], bullets: ["данные профиля MAX, переданные при входе: идентификатор аккаунта, имя, фамилия, имя пользователя и фотография профиля, если она доступна;", "имя и отображаемое имя, школа, класс, учебная роль, сведения о доступе и связи аккаунта с MAX;", "содержание учебных заданий, ответы, приложенные фотографии, сведения о сдаче работы, оценка и комментарии учителя;", "учебный прогресс, достижения, активность, баллы опыта, внутренний баланс и история операций, избранное, заказы и выбранные элементы оформления профиля;", "настройки сервиса и уведомлений, а также сообщения боту, если пользователь обращается к боту;", "технические сведения, необходимые для входа, поддержания сеанса, защиты от подделки запросов и расследования сбоев." ] },
      { id: "purposes", title: "3. Цели и основания обработки", paragraphs: ["Данные используются, чтобы создать и защитить учётную запись, предоставить доступ к сервису и школьному пространству, показывать подходящие задания, принимать и проверять ответы, передавать ученику обратную связь, вести личный прогресс и внутренние награды, исполнять заказы, отправлять выбранные пользователем уведомления, отвечать на обращения и поддерживать безопасность сервиса.", "Для каждой цели обработка ведётся на предусмотренном законом основании: когда это необходимо для предоставления выбранных функций и исполнения условий использования, для выполнения обязанностей, установленных законом, либо на основании отдельного согласия — в тех случаях, когда закон требует именно согласия. Отзыв согласия не отменяет обработку, для которой сохраняется иное законное основание." ] },
      { id: "sources", title: "4. Откуда поступают данные", paragraphs: ["Данные профиля поступают от пользователя и MAX при входе. Сведения об учебной группе, заданиях и проверке добавляют уполномоченные пользователи школы. Часть сведений о прогрессе и заказах формируется автоматически по действиям пользователя в сервисе."] },
      { id: "access", title: "5. Кто получает доступ к данным", paragraphs: ["Пользователь видит данные своего профиля, заданий, ответов, прогресса и заказов. Учителя получают доступ к заданиям и работам учеников закреплённых классов. Администраторы школы работают со сведениями своей школы в пределах своих полномочий. Владелец сервиса и уполномоченные им специалисты получают доступ только в объёме, необходимом для управления, поддержки и защиты сервиса.", "Данные могут обрабатываться провайдером, на площадке которого размещён сервис, по поручению оператора и для его работы. Сведения о провайдере и месте размещения опубликованы в разделе «Сведения о владельце сайта». MAX получает данные, необходимые для входа и доставки выбранных пользователем сообщений бота. Данные не публикуются для неопределённого круга лиц и не используются для рекламного профилирования." ] },
      { id: "max", title: "6. Вход и уведомления MAX", paragraphs: ["При входе через MAX сервис получает данные профиля, которые MAX передаёт мини-приложению для идентификации аккаунта. Для сообщений бота пользователь связывает аккаунт и запускает бота; сообщения отправляются с учётом настроек уведомлений. В MAX передаются идентификатор получателя и содержание выбранного уведомления. Пользователь может отключить отдельные уведомления в настройках или прекратить взаимодействие с ботом."] },
      { id: "cookies", title: "7. Файлы браузера и локальные настройки", paragraphs: ["Необходимые файлы браузера поддерживают вход в аккаунт и защищают запросы. При отключении таких файлов вход и защищённые функции могут перестать работать. Выбранная тема и некоторые настройки отображения могут сохраняться в браузере на устройстве пользователя. Сервис не использует рекламные файлы отслеживания."] },
      { id: "retention", title: "8. Сроки хранения", paragraphs: ["Данные хранятся не дольше, чем этого требуют цели обработки, требования закона и необходимость защитить права участников. Учебная история и сведения о заказах сохраняются, пока нужны для работы школьного пространства и подтверждения выполненных действий. Временные файлы, которые не были приложены к заданию, удаляются по истечении короткого срока. После достижения цели данные удаляются или обезличиваются, если закон или иное законное основание не требует их сохранить." ], fields: [{ key: "hostingProvider", label: "Провайдер размещения" }, { key: "serverLocation", label: "Место размещения данных" }] },
      { id: "children", title: "9. Данные несовершеннолетних", paragraphs: ["«Вайб» предназначен в том числе для школьников. Доступ к учебным сведениям ограничен учебной ролью, школой и классом. Если по закону согласие на обработку данных несовершеннолетнего должен дать его законный представитель, оператор получает такое согласие от представителя и проверяет его полномочия. Не загружайте сведения о здоровье, документы и другие данные, не нужные для учебного задания."] },
      { id: "security", title: "10. Защита данных", paragraphs: ["Оператор ограничивает доступ к данным учётными записями и полномочиями пользователей, использует защищённые сеансы и проверку запросов, а также принимает организационные и технические меры для предотвращения неправомерного доступа, изменения, раскрытия или утраты данных. Доступ учителей и администраторов определяется их ролью и учебной областью."] },
      { id: "rights", title: "11. Права пользователя и обращения", paragraphs: ["Пользователь или его представитель может запросить сведения об обработке, ознакомиться со своими данными, потребовать их уточнения, блокирования или удаления, а также отозвать согласие. Оператор рассматривает такие обращения в сроки, установленные законом; запрос информации обычно рассматривается в течение десяти рабочих дней, срок может быть продлён не более чем на пять рабочих дней с объяснением причины. Если согласие отозвано и нет другого законного основания для хранения, данные уничтожаются в срок, установленный законом.", "Напишите на vaibe32@mail.ru. Чтобы подготовить обращение, можно воспользоваться разделом «Обращение по вопросам персональных данных». Для аккаунта несовершеннолетнего обращение может направить его законный представитель." ] },
      { id: "changes", title: "12. Изменения Политики", paragraphs: ["Актуальная редакция доступна на этой странице. Если изменения затрагивают цели или состав обработки, оператор обновит документ и, когда того требует закон, отдельно запросит согласие."] },
    ],
  },
  "/legal/personal-data-consent": {
    title: "Согласие на обработку персональных данных",
    version: "2.0 · 01.11.2026",
    sections: [
      { id: "operator", title: "1. Оператор", paragraphs: ["Я даю согласие владельцу сервиса «Вайб», сведения о котором приведены в разделе «Сведения о владельце сайта». Контакт по вопросам персональных данных: vaibe32@mail.ru."], fields: operatorFields },
      { id: "purpose", title: "2. Цель согласия", paragraphs: ["Я даю согласие на создание и использование моей учётной записи в Вайбе, предоставление доступа к выбранным функциям школьного сервиса, ведение учебных заданий и ответов, отображение результатов и личного прогресса, работу внутренних наград и отправку выбранных мной уведомлений. Данные не используются для рекламы или продажи профиля."] },
      { id: "data", title: "3. Перечень данных", paragraphs: ["Согласие распространяется на следующие данные в той мере, в которой они нужны для выбранных функций: идентификатор и доступные сведения профиля MAX (имя, фамилия, имя пользователя, фотография профиля); имя и отображаемое имя; школа, класс, роль и состояние доступа; учебные задания, текстовые ответы и приложенные к ним фотографии; результаты проверки, оценки и комментарии; сведения о прогрессе, достижениях, внутреннем балансе, операциях и заказах; выбранное оформление профиля и настройки; настройки уведомлений, обращения к боту и технические сведения, необходимые для входа и защиты сервиса."] },
      { id: "actions", title: "4. Действия с данными", paragraphs: ["Я разрешаю собирать, записывать, систематизировать, накапливать, хранить, уточнять, извлекать, использовать, передавать для обработки уполномоченным лицам, предоставлять доступ в соответствии с учебной ролью, блокировать, удалять и обезличивать перечисленные данные. Обработка может выполняться с использованием средств автоматизации и без них."] },
      { id: "recipients", title: "5. Кому могут быть доступны данные", paragraphs: ["Доступ предоставляется владельцу сервиса и уполномоченным специалистам для управления и поддержки; учителям закреплённых классов и администраторам соответствующей школы для учебной работы; провайдеру размещения сервиса по поручению оператора; MAX — в объёме, необходимом для входа и доставки включённых уведомлений. Доступ каждого получателя ограничен его задачами. Данные не раскрываются неопределённому кругу лиц."] },
      { id: "duration", title: "6. Срок действия и отзыв", paragraphs: ["Согласие действует до достижения указанных целей, его отзыва или прекращения обработки по иному законному основанию. Я могу отозвать согласие, написав на vaibe32@mail.ru или направив обращение через раздел «Обращение по вопросам персональных данных». После получения отзыва оператор прекращает обработку, основанную только на этом согласии; если для хранения нет другого законного основания, данные уничтожаются в установленный законом срок. Отзыв не делает незаконной обработку, которая уже была выполнена на действовавшем основании."] },
      { id: "representative", title: "7. Согласие представителя", paragraphs: ["Если по закону согласие за несовершеннолетнего должен дать его законный представитель, согласие предоставляет представитель, имеющий соответствующие полномочия. Представитель может обратиться к оператору по указанному адресу для подтверждения полномочий и реализации прав ребёнка."] },
      { id: "separate", title: "8. Подтверждение", paragraphs: ["Это согласие оформляется отдельно от Пользовательского соглашения и других документов. Оно добровольное, конкретное и может быть отозвано. Отказ дать согласие не прекращает обработку, для которой у оператора есть другое предусмотренное законом основание; при этом отдельные функции, для которых согласие необходимо, могут быть недоступны."] },
    ],
  },
  "/legal/owner": {
    title: "Сведения о владельце сайта",
    version: "1.0",
    sections: [
      { id: "owner", title: "Владелец сервиса «Вайб»", fields: operatorFields },
      { id: "hosting", title: "Размещение сервиса", fields: [
        { key: "hostingProvider", label: "Провайдер размещения" },
        { key: "serverLocation", label: "Место хранения данных" },
      ] },
    ],
  },
};

const catalog = [
  { href: "/legal/terms", title: "Пользовательское соглашение", detail: "Правила использования сервиса." },
  { href: "/legal/privacy", title: "Политика обработки персональных данных", detail: "Какие сведения используются и как к ним предоставляется доступ." },
  { href: "/legal/personal-data-consent", title: "Согласие на обработку персональных данных", detail: "Отдельный документ о согласии." },
  { href: "/legal/owner", title: "Сведения о владельце сайта", detail: "Реквизиты и контакты владельца сервиса." },
  { href: "/legal/privacy-request", title: "Обращение по вопросам персональных данных", detail: "Подготовьте обращение владельцу сервиса." },
];

export function LegalFooter({ className = "" }: { className?: string }) {
  const settings = useQuery({ queryKey: ["public-legal-settings"], queryFn: () => api<PublicLegalSettings>("/legal/settings"), staleTime: 60_000 });
  const ownerName = settings.data?.organizationFullName?.trim();
  return <footer className={`legal-footer ${className}`}><span>© Вайб</span><nav aria-label="Разделы сайта"><a href="/faq">Вопросы и ответы</a><a href="/documents">Документы проекта</a><a href="/reviews">Отзывы</a><a href="mailto:vaibe32@mail.ru">Поддержка: vaibe32@mail.ru</a><a href="/legal">Правовая информация</a><a href="/legal/privacy">Политика персональных данных</a><a href="/legal/terms">Пользовательское соглашение</a></nav><span className="legal-footer-owner">{ownerName ? `Владелец сайта: ${ownerName}` : <a href="/legal/owner">Сведения о владельце сайта</a>}</span></footer>;
}

export function LegalAcceptanceGate({ children, onMessage }: { children: ReactNode; onMessage: (message: string) => void }) {
  const client = useQueryClient();
  const state = useQuery({ queryKey: ["legal-acceptance"], queryFn: () => api<AcceptanceState>("/legal/acceptance"), retry: false });
  const [termsChecked, setTermsChecked] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const accept = useMutation({ mutationFn: () => api("/legal/acceptance", { method: "POST", body: jsonBody({ termsAccepted: true, personalDataConsent: consentChecked }) }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["legal-acceptance"] }); onMessage("Подтверждение сохранено"); }, onError: (error: Error) => onMessage(error.message) });
  if (state.isLoading) return <div className="legal-gate-wait" aria-live="polite">Проверяем документы…</div>;
  if (state.isError) return <div className="legal-gate-wait"><strong>Не удалось проверить документы.</strong><p>Попробуйте обновить страницу.</p></div>;
  if (!state.data?.required.length) return <>{children}</>;
  const termsAlreadyAccepted = state.data.accepted.some((row) => row.documentType === "TERMS" && row.consentStatus === "ACKNOWLEDGED" && !row.revokedAt && row.documentVersion === state.data?.currentVersions.TERMS);
  const consentPending = state.data.required.some((row) => row.type === "PERSONAL_DATA_CONSENT");
  return <div className="legal-gate-overlay"><section className="legal-gate-card" role="dialog" aria-modal="true" aria-labelledby="legal-gate-title"><span className="legal-gate-icon"><ShieldCheck size={22} /></span><span className="eyebrow">ПЕРЕД ПРОДОЛЖЕНИЕМ</span><h1 id="legal-gate-title">Проверьте документы</h1><p>Для продолжения ознакомьтесь с актуальным Пользовательским соглашением. Политика обработки персональных данных доступна отдельно.</p>
    <label className={`legal-consent-choice ${termsAlreadyAccepted ? "is-done" : ""}`}><input type="checkbox" checked={termsAlreadyAccepted || termsChecked} disabled={termsAlreadyAccepted} onChange={(event) => setTermsChecked(event.target.checked)} /><span><strong>{termsAlreadyAccepted ? "Пользовательское соглашение уже принято" : "Я ознакомился с Пользовательским соглашением"}</strong><small>Редакция {state.data.currentVersions.TERMS}. <a href="/legal/terms" target="_blank" rel="noreferrer">Открыть документ</a></small></span></label>
    {consentPending && <label className="legal-consent-choice legal-consent-separate"><input type="checkbox" checked={consentChecked} onChange={(event) => setConsentChecked(event.target.checked)} /><span><strong>Я даю отдельное согласие на обработку персональных данных</strong><small>Редакция {state.data.currentVersions.PERSONAL_DATA_CONSENT}. <a href="/legal/personal-data-consent" target="_blank" rel="noreferrer">Открыть документ</a>. Это отдельный выбор.</small></span></label>}
    <p className="legal-gate-note">Согласие не объединяется с Пользовательским соглашением. Если вы не можете принять решение самостоятельно, обратитесь к законному представителю.</p>
    <button className="glass-button legal-gate-submit" type="button" disabled={accept.isPending || (!termsAlreadyAccepted && !termsChecked) || (consentPending && !consentChecked)} onClick={() => accept.mutate()}>{accept.isPending ? "Сохраняем…" : "Продолжить"}</button>
    <a className="legal-gate-privacy" href="/legal/privacy">Прочитать Политику обработки персональных данных</a>
  </section></div>;
}

type AcceptanceState = {
  authenticated: boolean;
  consentRequired: boolean;
  currentVersions: { TERMS: string; PERSONAL_DATA_CONSENT: string };
  required: Array<{ type: string; title: string; version: string }>;
  accepted: Array<{ documentType: string; documentVersion: string; consentStatus: string; acceptedAt: string; revokedAt: string | null }>;
};

export function LegalSite({ pathname, authenticated }: { pathname: string; authenticated: boolean }) {
  const normalizedPath = documents[pathname] || pathname === "/legal/privacy-request" ? pathname : "/legal";
  const isConsentPage = normalizedPath === "/legal/personal-data-consent";
  const acceptance = useQuery({ queryKey: ["legal-acceptance"], queryFn: () => api<AcceptanceState>("/legal/acceptance"), enabled: authenticated && isConsentPage, retry: false });
  const client = useQueryClient();
  const legalSettings = useQuery({ queryKey: ["public-legal-settings"], queryFn: () => api<PublicLegalSettings>("/legal/settings"), staleTime: 60_000 });
  const revoke = useMutation({ mutationFn: () => api("/legal/personal-data-consent/revoke", { method: "POST" }), onSuccess: () => { void client.invalidateQueries({ queryKey: ["legal-acceptance"] }); }, onError: (error: Error) => window.alert(error.message) });
  const currentConsent = acceptance.data?.accepted.find((row) => row.documentType === "PERSONAL_DATA_CONSENT" && row.consentStatus === "GRANTED" && !row.revokedAt);
  const selectedDocument = documents[normalizedPath];
  const configuredVersion = normalizedPath === "/legal/terms" ? legalSettings.data?.termsVersion : normalizedPath === "/legal/privacy" ? legalSettings.data?.privacyVersion : normalizedPath === "/legal/personal-data-consent" ? legalSettings.data?.consentVersion : null;
  const document = selectedDocument ? { ...selectedDocument, version: configuredVersion?.trim() || selectedDocument.version } : undefined;
  return <div className="legal-site"><header className="legal-site-header"><a className="brand-lockup" href={authenticated ? "/tasks" : "/"}><img className="brand-image" src="/brand/vibe-logo.png" alt="Вайб" /><small>школьная жизнь интереснее</small></a><a className="legal-back-link" href={normalizedPath === "/legal" ? (authenticated ? "/tasks" : "/") : "/legal"}><ArrowLeft size={16} />{normalizedPath === "/legal" ? "Вернуться в сервис" : "Все документы"}</a></header>
    <main className="legal-main"><div className="legal-heading"><h1>{normalizedPath === "/legal" ? "Правовая информация" : normalizedPath === "/legal/privacy-request" ? "Обращение по вопросам персональных данных" : document?.title ?? "Правовая информация"}</h1><p>{normalizedPath === "/legal" ? "Правила сервиса, политика обработки данных и контакты." : normalizedPath === "/legal/privacy-request" ? "Подготовьте текст обращения владельцу сервиса." : "Условия и сведения о работе сервиса «Вайб»."}</p></div>
    {normalizedPath === "/legal" ? <div className="legal-card-grid">{catalog.map((item) => <a id={`legal-${item.href.split("/").at(-1)}`} href={item.href} className="legal-card" key={item.href}><span className="legal-card-icon"><FileText size={19} /></span><strong>{item.title}</strong><small>{item.detail}</small><span className="legal-card-link">Открыть <ArrowUpRight size={15} /></span></a>)}</div>
      : normalizedPath === "/legal/privacy-request" ? <>
        <nav className="legal-toc" aria-label="Разделы обращения"><strong>Содержание</strong><ol><li><a href="#request-how">Как обратиться</a></li><li><a href="#request-form">Подготовить обращение</a></li><li><a href="#request-safety">Безопасность</a></li></ol></nav>
        <PrivacyRequestBuilder privacyEmail={legalSettings.data?.privacyEmail ?? null} />
      </>
      : <>{document && <DocumentView document={document} settings={legalSettings.data} />}{isConsentPage && currentConsent && <section className="legal-revoke-card"><div><strong>Согласие этой редакции действует</strong><small>Принято: {new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" }).format(new Date(currentConsent.acceptedAt))}</small></div><button className="glass-button button-secondary" disabled={revoke.isPending} onClick={() => { if (window.confirm("Отозвать согласие этой редакции?")) revoke.mutate(); }}>{revoke.isPending ? "Сохраняем…" : "Отозвать согласие"}</button></section>}</>}
    </main><LegalFooter className="legal-site-footer" /></div>;
}

function DocumentView({ document, settings }: { document: LegalDocument; settings?: PublicLegalSettings }) {
  return <article className="legal-document"><div className="legal-document-meta"><span>Редакция {document.version}</span></div><nav className="legal-toc" aria-label="Оглавление"><strong>Содержание</strong><ol>{document.sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>)}</ol></nav><div className="legal-document-body">{document.sections.map((section) => {
    const fields = (section.fields ?? []).flatMap(({ key, label }) => {
      const value = settings?.[key]?.trim();
      return value ? [{ label, value }] : [];
    });
    return <section id={section.id} key={section.id}><h2>{section.title}</h2>{section.paragraphs?.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.bullets && <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>}{fields.length > 0 && <dl className="legal-configured-fields">{fields.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}</section>;
  })}</div></article>;
}

function PrivacyRequestBuilder({ privacyEmail }: { privacyEmail: string | null }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [requestType, setRequestType] = useState("Получить информацию об обработке персональных данных");
  const [details, setDetails] = useState("");
  const [notice, setNotice] = useState("");
  const requestText = useMemo(() => ["Обращение по вопросам персональных данных", ...(privacyEmail ? [`Кому: ${privacyEmail}`] : []), ...(name.trim() ? [`От: ${name.trim()}`] : []), ...(contact.trim() ? [`Контакт для ответа: ${contact.trim()}`] : []), `Запрос: ${requestType}`, "", details.trim()].filter(Boolean).join("\n"), [name, contact, requestType, details, privacyEmail]);
  const download = () => { const blob = new Blob([requestText], { type: "text/plain;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "obrashchenie-po-personalnym-dannym.txt"; anchor.click(); URL.revokeObjectURL(url); setNotice("Черновик скачан. Отправьте его по контактам владельца сайта."); };
  const copy = async () => { try { await navigator.clipboard.writeText(requestText); setNotice("Текст обращения скопирован. Его можно отправить владельцу сайта."); } catch { setNotice("Браузер запретил копирование. Скачайте текст отдельной кнопкой."); } };
  return <section className="legal-request-card"><div id="request-how"><p>Подготовленный текст не отправляется автоматически. Скопируйте его или скачайте, а затем отправьте владельцу сайта.</p>{privacyEmail && <div className="legal-request-contact"><strong>Контакт владельца:</strong> {privacyEmail}</div>}</div><div id="request-form"><label className="field"><span>Ваше имя (необязательно)</span><input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span>Контакт для ответа</span><input value={contact} maxLength={240} onChange={(event) => setContact(event.target.value)} /></label><label className="field"><span>Тип обращения</span><select value={requestType} onChange={(event) => setRequestType(event.target.value)}><option>Получить информацию об обработке персональных данных</option><option>Уточнить персональные данные</option><option>Заблокировать или прекратить обработку</option><option>Отозвать согласие</option><option>Иное обращение</option></select></label><label className="field"><span>Описание обращения</span><textarea rows={5} maxLength={4000} value={details} onChange={(event) => setDetails(event.target.value)} /></label><div className="legal-request-actions"><button className="glass-button" type="button" onClick={download}><Download size={16} />Скачать обращение</button><button className="glass-button button-secondary" type="button" onClick={() => void copy()}><Copy size={16} />Скопировать текст</button></div>{notice && <p className="legal-request-notice" role="status">{notice}</p>}</div><p className="legal-request-note" id="request-safety">Не включайте в обращение пароль, код входа, банковские реквизиты или сведения, не относящиеся к запросу.</p></section>;
}
