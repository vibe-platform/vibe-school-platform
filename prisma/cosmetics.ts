import type { CosmeticType } from "@prisma/client";

export const cosmetics: Array<{ slug: string; type: CosmeticType; level: number; name: string; asset: string; value: string; group?: string }> = [
  { slug: "pearl", type: "PROFILE_BACKGROUND", level: 1, name: "Жемчужный", asset: "bg-pearl", value: "pearl" },
  { slug: "emoji-none", type: "NICK_EMOJI", level: 1, name: "Без эмодзи", asset: "emoji-none", value: "" },
  { slug: "frame-none", type: "AVATAR_FRAME", level: 1, name: "Без рамки", asset: "frame-none", value: "" },
  { slug: "title-none", type: "PROFILE_TITLE", level: 1, name: "Без подписи", asset: "title-none", value: "" },
  { slug: "pattern-none", type: "PROFILE_PATTERN", level: 1, name: "Без узора", asset: "pattern-none", value: "" },
  ...["🌱", "✨", "💡", "☀️", "🎨", "📚"].map((emoji, index) => ({ slug: `spark-${index + 1}`, type: "NICK_EMOJI" as const, level: 2, name: `Искра ${index + 1}`, asset: `emoji-spark-${index + 1}`, value: emoji, group: "Искра" })),
  ...[
    ["dawn", "Рассвет", "dawn"], ["lavender", "Лаванда", "lavender"], ["mint-cloud", "Мятное облако", "mint-cloud"],
  ].map(([slug, name, value]) => ({ slug: `bg-${slug}`, type: "PROFILE_BACKGROUND" as const, level: 3, name, asset: `bg-${value}`, value })),
  ...[
    ["thin-glass", "Тонкое стекло"], ["orbit", "Орбита"], ["soft-outline", "Мягкий контур"],
  ].map(([slug, name]) => ({ slug: `frame-${slug}`, type: "AVATAR_FRAME" as const, level: 4, name, asset: `frame-${slug}`, value: slug })),
  ...["Исследователь", "Мечтатель", "Создатель", "Собиратель идей"].map((name, index) => ({ slug: `title-${index + 1}`, type: "PROFILE_TITLE" as const, level: 5, name, asset: `title-${index + 1}`, value: name })),
  ...[
    ["aurora", "Северное сияние", "aurora"], ["moonlight", "Лунный свет", "moonlight"],
  ].map(([slug, name, value]) => ({ slug: `bg-${slug}`, type: "PROFILE_BACKGROUND" as const, level: 6, name, asset: `bg-${value}`, value })),
  ...[
    ["lavender-glow", "Лавандовое сияние"], ["mint-glass", "Мятное стекло"],
  ].map(([slug, name]) => ({ slug: `frame-${slug}`, type: "AVATAR_FRAME" as const, level: 6, name, asset: `frame-${slug}`, value: slug })),
  ...["🪐", "🔭", "🧩", "🎧", "🎭", "🧪"].map((emoji, index) => ({ slug: `interest-${index + 1}`, type: "NICK_EMOJI" as const, level: 7, name: `Интерес ${index + 1}`, asset: `emoji-interest-${index + 1}`, value: emoji, group: "Интересы" })),
  ...[
    ["hologram", "Голограмма"], ["crystal", "Кристалл"],
  ].map(([slug, name]) => ({ slug: `frame-${slug}`, type: "AVATAR_FRAME" as const, level: 8, name, asset: `frame-${slug}`, value: slug })),
  ...["bubble", "sparkles", "constellations"].map((slug, index) => ({ slug: `pattern-${slug}`, type: "PROFILE_PATTERN" as const, level: 9, name: ["Пузырьки", "Искры", "Созвездия"][index]!, asset: `pattern-${slug}`, value: slug })),
  { slug: "bg-cosmic-mist", type: "PROFILE_BACKGROUND", level: 10, name: "Космическая дымка", asset: "bg-cosmic", value: "cosmic", group: "Космос" },
  { slug: "frame-rings", type: "AVATAR_FRAME", level: 10, name: "Космическая орбита", asset: "frame-rings", value: "rings", group: "Космос" },
  { slug: "emoji-satellite", type: "NICK_EMOJI", level: 10, name: "Спутник", asset: "emoji-satellite", value: "🛰️", group: "Космос" },
  { slug: "title-traveler", type: "PROFILE_TITLE", level: 10, name: "Путешественник", asset: "title-traveler", value: "Путешественник", group: "Космос" },
  { slug: "pattern-stardust", type: "PROFILE_PATTERN", level: 10, name: "Звёздная пыль", asset: "pattern-stardust", value: "stardust", group: "Космос" },
];
