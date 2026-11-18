import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { memberRegisterSchema } from '@may-cafe/contracts';
import { validationMessage } from '../../utils/validationMessage.js';

const messageFor = (schema: z.ZodTypeAny, value: unknown) => {
  const result = schema.safeParse(value);
  if (result.success) throw new Error('expected invalid input');
  return validationMessage(result.error);
};

describe('thông báo lỗi dữ liệu', () => {
  it('đăng ký thành viên nói rõ từng ô sai', () => {
    expect(messageFor(memberRegisterSchema, { name: 'A', phone: '0123', password: '123' })).toBe(
      'Số điện thoại phải là số di động Việt Nam gồm 10 chữ số, bắt đầu bằng 03, 05, 07, 08 hoặc 09 (hoặc +84). ' +
        'Tên cần ít nhất 2 ký tự. Mật khẩu cần ít nhất 8 ký tự.',
    );
    expect(messageFor(memberRegisterSchema, { name: 'Lan', password: 'Password@1' })).toBe(
      'Vui lòng nhập số điện thoại.',
    );
    expect(
      messageFor(memberRegisterSchema, {
        name: 'Lan',
        phone: '0909123456',
        password: 'x'.repeat(65),
      }),
    ).toBe('Mật khẩu tối đa 64 ký tự.');
  });

  it('dịch các lỗi mặc định của zod sang tiếng Việt kèm tên trường', () => {
    const schema = z.object({ email: z.string().email(), quantity: z.number().max(5) }).strict();
    expect(messageFor(schema, { email: 'abc', quantity: 9 })).toBe(
      'Email không hợp lệ. Số lượng không được lớn hơn 5.',
    );
    expect(messageFor(schema, { quantity: 1 })).toBe('Email là bắt buộc.');
    expect(messageFor(schema, { email: 'a@b.vn', quantity: 1, role: 'ADMIN' })).toBe(
      'Có trường không được hỗ trợ: role.',
    );
  });
});
