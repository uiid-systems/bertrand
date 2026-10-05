/**
 * The Tier 3 verdict from a runs file (docs/context-budget.md): per task, the
 * paired log-ratio of processed tokens, treatment over control, averaged over
 * repeats; across tasks, its median with a bootstrap CI. Processed tokens
 * already include the injected history being re-read on every request, so
 * the ratio is net of Tier 2's own cost.
 */

export interface RunRecord {
  task: string;
  arm: "control" | "treatment";
  rep: number;
  /** input + cache creation + cache read, summed over requests. */
  processed: number;
  requests: number;
  systemBytes: number;
  /** Every answer-key fact appears in the answer. */
  correct: boolean;
  error?: string;
}

export interface TaskPair {
  task: string;
  /** exp(mean ln treatment − mean ln control). Below 1 means treatment saved. */
  ratio: number;
  control: { runs: number; correct: number };
  treatment: { runs: number; correct: number };
}

export interface Verdict {
  tasks: TaskPair[];
  medianRatio: number;
  ci: [number, number];
  correct: { control: number; treatment: number };
  /** Upper CI bound below 1, and no fewer correct answers. */
  ship: boolean;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Deterministic PRNG, so a report is reproducible from its runs file. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function verdict(runs: RunRecord[], resamples = 2000, seed = 1): Verdict | null {
  const ok = runs.filter((r) => !r.error && r.processed > 0);
  const byTask = new Map<string, RunRecord[]>();
  for (const r of ok) byTask.set(r.task, [...(byTask.get(r.task) ?? []), r]);

  const tasks: TaskPair[] = [];
  for (const [task, rs] of byTask) {
    const ctl = rs.filter((r) => r.arm === "control");
    const trt = rs.filter((r) => r.arm === "treatment");
    // Unpaired tasks can't contribute: the design's point is that each task
    // is its own control.
    if (ctl.length === 0 || trt.length === 0) continue;
    const logMean = (xs: RunRecord[]) => mean(xs.map((r) => Math.log(r.processed)));
    tasks.push({
      task,
      ratio: Math.exp(logMean(trt) - logMean(ctl)),
      control: { runs: ctl.length, correct: ctl.filter((r) => r.correct).length },
      treatment: { runs: trt.length, correct: trt.filter((r) => r.correct).length },
    });
  }
  if (tasks.length === 0) return null;

  const logs = tasks.map((t) => Math.log(t.ratio));
  const rand = mulberry32(seed);
  const boot: number[] = [];
  for (let i = 0; i < resamples; i++) {
    boot.push(median(logs.map(() => logs[Math.floor(rand() * logs.length)]!)));
  }
  boot.sort((a, b) => a - b);
  const ci: [number, number] = [
    Math.exp(boot[Math.floor(resamples * 0.025)]!),
    Math.exp(boot[Math.ceil(resamples * 0.975) - 1]!),
  ];

  const rate = (arm: "control" | "treatment") => {
    const n = tasks.reduce((s, t) => s + t[arm].runs, 0);
    return tasks.reduce((s, t) => s + t[arm].correct, 0) / n;
  };
  const correct = { control: rate("control"), treatment: rate("treatment") };

  return {
    tasks,
    medianRatio: Math.exp(median(logs)),
    ci,
    correct,
    ship: ci[1] < 1 && correct.treatment >= correct.control,
  };
}

/** Case-insensitive: every fact of the key appears in the answer. */
export function isCorrect(answer: string, answerKey: string[]): boolean {
  const text = answer.toLowerCase();
  return answerKey.every((fact) => text.includes(fact.toLowerCase()));
}
