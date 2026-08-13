export class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpRequestError";
  }
}

export interface HttpClientOptions {
  readonly baseUrl?: string;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {},
  clientOptions: HttpClientOptions = {},
): Promise<T> {
  const baseUrl = clientOptions.baseUrl ?? "/api";
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { "content-type": "application/json" },
    ...options,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const data = (await response.json().catch(() => ({}))) as {
    readonly error?: unknown;
  };
  if (!response.ok) {
    const message =
      typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new HttpRequestError(response.status, message);
  }
  return data as T;
}
