import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/__tests__/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: 'forks',
    // Mỗi file test chạy trong process riêng (module registry sạch: tránh OverwriteModelError của Mongoose
    // khi nhiều file cùng import model), nhưng tuần tự để không dựng nhiều MongoMemoryReplSet song song.
    isolate: true,
    fileParallelism: false,
    minWorkers: 1,
    maxWorkers: 1,
  },
});
