import type { AnomalyEvaluation } from '@may-cafe/contracts';
import { connectMongo, disconnectMongo } from '../src/infrastructure/mongo.js';
import { buildAIService, type RecommendInput } from '../src/services/aiService.js';
import { explainAnomaly } from '../src/services/anomalyExplanationService.js';

const cases: Array<{ name: string; input: RecommendInput }> = [
  { name: 'budget', input: { prompt: 'Gợi ý đồ uống dễ uống dưới 45 nghìn', maxBudget: 45_000 } },
  { name: 'no-caffeine', input: { prompt: 'Tôi muốn món không caffeine', preferences: { noCaffeine: true } } },
  { name: 'no-dairy', input: { prompt: 'Gợi ý món không sữa dưới 60 nghìn', preferences: { noDairy: true }, maxBudget: 60_000 } },
];

async function main(): Promise<void> {
  await connectMongo();
  try {
    const service = buildAIService();
    const recommendations = [];
    for (const testCase of cases) {
      const result = await service.recommend(testCase.input);
      recommendations.push({
        name: testCase.name,
        mode: result.mode,
        count: result.recommendations.length,
        latencyMs: result.latencyMs,
        budgetValid: result.recommendations.every((item) => item.unitPrice <= (testCase.input.maxBudget ?? Infinity)),
      });
    }
    const now = new Date();
    const evaluation: AnomalyEvaluation = {
      detector: 'HTTP_LATENCY_P95',
      target: 'all',
      state: 'ALERT',
      severity: 'WARNING',
      windowStart: new Date(now.getTime() - 15 * 60_000).toISOString(),
      windowEnd: now.toISOString(),
      observedValue: 1_600,
      thresholdValue: 1_000,
      baselineValue: 220,
      sampleCount: 300,
      baselineSampleCount: 1_200,
      method: 'Synthetic live-provider schema check.',
      evidence: { requests: 300, slowestRoutes: [{ route: '/api/v1/products', p95Ms: 1_600, samples: 180 }] },
    };
    const explanation = await explainAnomaly(evaluation);
    process.stdout.write(JSON.stringify({
      recommendationCases: recommendations,
      anomaly: {
        mode: explanation.mode,
        evidenceCount: explanation.evidence.length,
        hypothesisCount: explanation.hypotheses.length,
        checkCount: explanation.checks.length,
      },
    }) + '\n');
  } finally {
    await disconnectMongo();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
