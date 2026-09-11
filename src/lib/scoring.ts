import type { CategoryScores, Issue, IssueCategory, Severity } from "./types";
import { round } from "./similarity";

const SEVERITY_PENALTY: Record<Severity, number> = {
  high: 14,
  medium: 7,
  low: 3,
};

function scoreForCategory(issues: Issue[], category: IssueCategory): number {
  const relevant = issues.filter((i) => i.category === category);
  let score = 100;
  for (const issue of relevant) {
    score -= SEVERITY_PENALTY[issue.severity];
  }
  return Math.max(0, Math.min(100, round(score)));
}

export function computeScores(issues: Issue[]): { overallScore: number; categoryScores: CategoryScores } {
  const categoryScores: CategoryScores = {
    visual: scoreForCategory(issues, "visual"),
    content: scoreForCategory(issues, "content"),
    layout: scoreForCategory(issues, "layout"),
    ux: scoreForCategory(issues, "ux"),
  };

  const overallScore = round(
    (categoryScores.visual + categoryScores.content + categoryScores.layout + categoryScores.ux) / 4
  );

  return { overallScore, categoryScores };
}
