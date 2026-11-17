import { ValidationError } from '../errors/AppError.js';

/** Đọc tham số query của các trang quản trị; giá trị sai trả 422 thay vì bị bỏ qua. */
export function parseDate(v: unknown, nextDay = false): Date | undefined {
  if (typeof v !== 'string') return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new ValidationError('Ngày không hợp lệ.');
  if (nextDay) d.setDate(d.getDate() + 1);
  return d;
}

export function parseRating(v: unknown): number | undefined {
  if (v === undefined || v === '') return undefined;
  const rating = Number(v);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    throw new ValidationError('Số sao phải từ 1 đến 5.');
  return rating;
}

export function parsePositiveInt(v: unknown): number | undefined {
  if (v === undefined) return undefined;
  const number = Number(v);
  if (!Number.isInteger(number) || number < 1) throw new ValidationError('Trang không hợp lệ.');
  return number;
}
