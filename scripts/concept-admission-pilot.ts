import { getAiConfig } from "@/lib/ai/config";
import { getAiProvider } from "@/lib/ai/provider";
import { getSessionById, listMessagesBySessionId } from "@/lib/db/queries";
import {
  CONCEPT_ADMISSION_PILOT_APPLY_ERROR,
  CONCEPT_ADMISSION_PILOT_HELP,
  formatConceptAdmissionPilotSummary,
  runConceptAdmissionPilot,
  type AdmissionEvidenceSession,
} from "@/lib/concepts/admission/pilot";

function loadSession(sessionId: string): AdmissionEvidenceSession | null {
  const session = getSessionById(sessionId);
  if (!session) {
    return null;
  }
  const messages = listMessagesBySessionId(sessionId);
  return {
    sessionId: session.id,
    occurredAt: session.occurredAt,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      sourceCreatedAt: message.sourceCreatedAt,
    })),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--apply")) {
    console.error(CONCEPT_ADMISSION_PILOT_APPLY_ERROR);
    process.exit(1);
  }

  const config = getAiConfig();
  if (!config.apiKey || !config.model || config.provider !== "openai") {
    console.error("AI provider is not configured.");
    process.exit(1);
  }

  const provider = getAiProvider();
  const result = await runConceptAdmissionPilot(argv, {
    generateStructured: (request) => provider.generateStructured(request),
    loadSession,
  });

  if (!result.ok) {
    console.error(
      result.error === CONCEPT_ADMISSION_PILOT_HELP
        ? CONCEPT_ADMISSION_PILOT_HELP
        : result.error,
    );
    process.exit(1);
  }

  console.log(formatConceptAdmissionPilotSummary(result.report));
}

void main();
