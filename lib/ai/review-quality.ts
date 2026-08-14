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
