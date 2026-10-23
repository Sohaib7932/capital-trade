/** An error with an HTTP status, returned to the client as `{ detail }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string) => new HttpError(400, message);
export const notFound = (message = "Not found") => new HttpError(404, message);
export const unauthorized = (message = "Please sign in") => new HttpError(401, message);
export const forbidden = (message = "You don't have permission to do that") => new HttpError(403, message);
export const conflict = (message: string) => new HttpError(409, message);
