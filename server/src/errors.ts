export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class Cancelled extends Error {
  constructor() {
    super("已取消");
  }
}

export function isCancelled(err: unknown, signal?: AbortSignal): boolean {
  if (err instanceof Cancelled) return true;
  return signal?.aborted === true;
}
