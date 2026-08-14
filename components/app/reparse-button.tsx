import { RefreshCw } from "lucide-react";
import { reparseSession } from "@/app/(app)/sessions/actions";

export function ReparseButton({ sessionId }: { sessionId: string }) {
  return (
    <form action={reparseSession}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-2 text-xs font-bold text-muted hover:border-blue-200 hover:text-blue-700"
      >
        <RefreshCw className="size-3.5" aria-hidden="true" />
        発言を再解析
      </button>
    </form>
  );
}
