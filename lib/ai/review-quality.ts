export function isWeakNextQuestion(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    return true;
  }
  if (/検討する必要があるか/.test(trimmed)) {
    return true;
  }
  if (/次のステップは何か/.test(trimmed)) {
    return true;
  }
  if (/今後どうすればよいか/.test(trimmed)) {
    return true;
  }
  if (/(必要|すべき)ですか[？?]?$/.test(trimmed)) {
    return true;
  }
  return false;
}

export function isGenericCommonTheme(text: string) {
  const compact = text.replaceAll(/\s/g, "").replaceAll(/[。．]/g, "");
  const generics = [
    "AI活用",
    "知識整理",
    "ツール開発",
    "AIとの対話",
    "AIの利用方法",
  ];
  return generics.includes(compact);
}

export function claimLeapsToUnmentionedDomain(
  claim: string,
  evidenceText: string,
) {
  const leapTerms = [
    "リピートユーザー",
    "ユーザー獲得",
    "顧客獲得",
    "再利用率",
    "SaaS成長",
    "顧客維持",
    "組織の生産性",
  ];
  const evidenceHas = (term: string) => evidenceText.includes(term);
  return leapTerms.some((term) => claim.includes(term) && !evidenceHas(term));
}

export function textsAreNearDuplicates(left: string, right: string) {
  const normalize = (value: string) =>
    value.replaceAll(/\s/g, "").replaceAll(/[。、．，]/g, "");
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  return a.includes(b) || b.includes(a);
}

const EXAGGERATION_TERMS = [
  "劇的",
  "決定的",
  "飛躍的",
  "革新的",
  "大幅",
  "圧倒的",
];

const UNVERIFIABLE_PHRASES = [
  "劇的に改善する",
  "次のレベルへ進める",
  "決定的な洞察",
  "大きな価値を生む",
  "効果が非常に高い",
  "成功につながる可能性が高い",
];

export function hasUnsupportedExaggeration(text: string) {
  return EXAGGERATION_TERMS.some((term) => text.includes(term));
}

export function isUnverifiableHypothesis(text: string) {
  return UNVERIFIABLE_PHRASES.some((phrase) => text.includes(phrase));
}

export function isVagueValidationIdea(text: string) {
  const compact = text.replaceAll(/\s/g, "");
  if (!compact) {
    return true;
  }
  if (compact === "今後確認する" || compact === "今後確認する。") {
    return true;
  }
  if (compact === "使ってみる" || compact === "使ってみる。") {
    return true;
  }
  return false;
}

export function isPsychologicalOverclaim(text: string) {
  return (
    /恐れている/.test(text) ||
    /強く望んでいる/.test(text) ||
    /不安を感じ/.test(text)
  );
}
