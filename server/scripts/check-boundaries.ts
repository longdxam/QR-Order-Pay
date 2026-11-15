import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const controllerDir = path.resolve(process.cwd(), 'src/controllers');
const files = (await readdir(controllerDir)).filter((file) => file.endsWith('.ts'));
const violations: string[] = [];
for (const file of files) {
  const source = await readFile(path.join(controllerDir, file), 'utf8');
  if (/from ['"]\.\.\/models\//.test(source))
    violations.push(
      `${file}: controller must call a service/repository instead of importing a model`,
    );
  if (/from ['"]\.\.\/infrastructure\/unitOfWork/.test(source))
    violations.push(`${file}: transaction boundaries belong in services`);
}

// Service đã chuyển hẳn sang repository: chỉ được `import type` từ models. Danh sách chỉ được thêm,
// không bớt; các service khác còn truy vấn Mongoose trực tiếp (xem docs/defense-notes.md mục 9).
const repositoryOnlyServices = ['paymentService.ts'];
const serviceDir = path.resolve(process.cwd(), 'src/services');
for (const file of repositoryOnlyServices) {
  const source = await readFile(path.join(serviceDir, file), 'utf8');
  for (const [statement] of source.matchAll(
    /^import\s+(?!type\b)[^;]*from ['"]\.\.\/models\/[^'"]+['"]/gm,
  ))
    violations.push(`${file}: must reach MongoDB through a repository (${statement.trim()})`);
}
if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exitCode = 1;
} else process.stdout.write('module boundaries: OK\n');
