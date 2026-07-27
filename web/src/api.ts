const API_URL = import.meta.env.VITE_API_URL ?? "";

function csrfToken() {
  return document.cookie.split("; ").find((part) => part.startsWith("csrf="))?.split("=")[1];
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const hasBody = init.body !== undefined && init.body !== null;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken() ? { "x-csrf-token": decodeURIComponent(csrfToken()!) } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`La solicitud falló (${response.status})`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
