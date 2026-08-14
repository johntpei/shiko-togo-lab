import { ComingSoon } from "@/components/app/coming-soon";

export const metadata = {
  title: "統合レビュー",
};

export default function NewReviewPage() {
  return (
    <ComingSoon
      title="今週をレビューする"
      description="対象 Session を選んで統合レビューを実行し、そこから Context Pack へ進めるようにします。"
    />
  );
}
