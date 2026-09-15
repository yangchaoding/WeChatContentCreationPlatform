export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) { super(message); }
}

export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, { method: options.method || 'GET', signal: options.signal, ...(options.body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options.body) }) });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new ApiError('连接不到本地服务，请确认墨排已启动。', 0);
  }
  const data = await response.json().catch(() => ({ message: '本地服务返回了无法读取的内容。' }));
  if (!response.ok) throw new ApiError(data.message || '操作失败，请重试。', response.status, data.code);
  return data as T;
}

export function query(values: Record<string, string>) { return new URLSearchParams(values).toString(); }
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试。'; }
