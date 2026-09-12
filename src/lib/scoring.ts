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
    content: scoreForCategory(issues, "content"),
    extraText: scoreForCategory(issues, "extra-text"),
    colors: scoreForCategory(issues, "colors"),
    images: scoreForCategory(issues, "images"),
    icons: scoreForCategory(issues, "icons"),
    links: scoreForCategory(issues, "links"),
    buttons: scoreForCategory(issues, "buttons"),
    forms: scoreForCategory(issues, "forms"),
  };

  const values = Object.values(categoryScores);
  const overallScore = round(values.reduce((sum, v) => sum + v, 0) / values.length);

  return { overallScore, categoryScores };
}
