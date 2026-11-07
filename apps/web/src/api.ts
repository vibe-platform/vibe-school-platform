export class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

function csrfToken() {
  const match = document.cookie.match(/(?:^|; )vibe_csrf=([^;]+)/u);
  return match ? decodeURIComponent(match[1]!) : "";
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !path.startsWith("/auth/") && !path.startsWith("/dev/")) headers.set("x-csrf-token", csrfToken());
  headers.set("accept", "application/json");
  const response = await fetch(`/api${path}`, { ...init, method, headers, credentials: "include" });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) {
    const message = typeof data.error === "string" ? data.error : "Не удалось выполнить действие. Попробуйте ещё раз.";
    const technicalDetails = /(?:DATABASE_URL|UPLOAD_DIR|node_modules|sqlite|prisma|stack trace|\/api\/|\.env|\.ts\b|\.js\b|constraint failed|foreign key|invalid input syntax|HTTP\s*\d{3})/iu.test(message);
    throw new ApiError(technicalDetails ? "Не удалось выполнить действие. Попробуйте ещё раз." : message, response.status);
  }
  return data as T;
}

export function jsonBody(value: unknown) { return JSON.stringify(value); }
