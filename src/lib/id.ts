import { nanoid } from "nanoid";

export function createId(size = 12): string {
  return nanoid(size);
}
