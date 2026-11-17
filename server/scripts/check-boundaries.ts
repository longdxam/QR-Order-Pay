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

// Chỉ repository (cùng models, seeds, migration và test) được dùng Mongoose model. Service, middleware
// và realtime chỉ được `import type` từ models: mọi truy vấn MongoDB đi qua src/repositories.
const dataAccessFree = ['services', 'middlewares', 'realtime', 'routes', 'ai', 'utils'];
const valueImport = /^import\s+(?!type\b)[^;]*from ['"]\.\.\/models\/[^'"]+['"]/gm;
for (const dir of dataAccessFree) {
  const absolute = path.resolve(process.cwd(), 'src', dir);
  for (const file of (await readdir(absolute)).filter((name) => name.endsWith('.ts'))) {
    const source = await readFile(path.join(absolute, file), 'utf8');
    for (const [statement] of source.matchAll(valueImport))
      violations.push(
        `${dir}/${file}: must reach MongoDB through a repository (${statement.trim()})`,
      );
  }
}
if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exitCode = 1;
} else process.stdout.write('module boundaries: OK\n');
