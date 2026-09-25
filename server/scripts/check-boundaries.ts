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
if (violations.length > 0) {
  process.stderr.write(`${violations.join('\n')}\n`);
  process.exitCode = 1;
} else process.stdout.write('module boundaries: OK\n');
