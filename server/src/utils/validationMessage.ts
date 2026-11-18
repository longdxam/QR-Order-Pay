import type { ZodError, ZodIssue } from 'zod';

/** Tên tiếng Việt của các trường hay gặp, để thông báo lỗi chỉ đúng ô cần sửa. */
const FIELD_LABELS: Record<string, string> = {
  name: 'Tên',
  phone: 'Số điện thoại',
  email: 'Email',
  password: 'Mật khẩu',
  currentPassword: 'Mật khẩu hiện tại',
  newPassword: 'Mật khẩu mới',
  code: 'Mã',
  reason: 'Lý do',
  note: 'Ghi chú',
  quantity: 'Số lượng',
  amount: 'Số tiền',
  value: 'Giá trị',
  startsAt: 'Thời gian bắt đầu',
  endsAt: 'Thời gian kết thúc',
  partySize: 'Số khách',
  message: 'Lời nhắn',
};

const VIETNAMESE = /[à-ỹÀ-Ỹđ]/;

function label(issue: ZodIssue): string {
  const key = [...issue.path].reverse().find((part) => typeof part === 'string');
  return (key && FIELD_LABELS[key]) || (key ? `Trường "${key}"` : 'Dữ liệu');
}

/** Một câu tiếng Việt cho từng lỗi: ưu tiên thông báo đã viết sẵn trong schema. */
export function issueMessage(issue: ZodIssue): string {
  if (VIETNAMESE.test(issue.message)) return issue.message;
  const field = label(issue);
  switch (issue.code) {
    case 'invalid_type':
      return issue.received === 'undefined' || issue.received === 'null'
        ? `${field} là bắt buộc.`
        : `${field} không đúng định dạng.`;
    case 'too_small':
      if (issue.type === 'string')
        return Number(issue.minimum) <= 1
          ? `${field} không được để trống.`
          : `${field} cần ít nhất ${issue.minimum} ký tự.`;
      if (issue.type === 'array') return `${field} cần ít nhất ${issue.minimum} mục.`;
      return `${field} phải từ ${issue.minimum} trở lên.`;
    case 'too_big':
      if (issue.type === 'string') return `${field} tối đa ${issue.maximum} ký tự.`;
      if (issue.type === 'array') return `${field} tối đa ${issue.maximum} mục.`;
      return `${field} không được lớn hơn ${issue.maximum}.`;
    case 'invalid_string':
      return issue.validation === 'email'
        ? 'Email không hợp lệ.'
        : `${field} không đúng định dạng.`;
    case 'invalid_enum_value':
      return `${field} không thuộc các lựa chọn cho phép.`;
    case 'unrecognized_keys':
      return `Có trường không được hỗ trợ: ${issue.keys.join(', ')}.`;
    default:
      return `${field} không hợp lệ.`;
  }
}

/** Gộp tối đa 3 lỗi đầu (mỗi trường một lỗi) thành thông báo hiển thị cho người dùng. */
export function validationMessage(error: ZodError): string {
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push(issueMessage(issue));
    if (messages.length === 3) break;
  }
  return messages.join(' ') || 'Dữ liệu chưa hợp lệ.';
}
