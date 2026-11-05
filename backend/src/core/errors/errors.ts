export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new AppError(404, "not_found", `${what} not found`);
export const forbidden = (msg = "Forbidden") => new AppError(403, "forbidden", msg);
export const conflict = (msg: string) => new AppError(409, "conflict", msg);
