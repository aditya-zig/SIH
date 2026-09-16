// Frontend caller for POST /functions/v1/generate-training-draft (T07 contract).
// Fixture fallback must display DEMO SAMPLE — NOT GENERATED FROM THIS WORKPLACE.
export const DEMO_SAMPLE_LABEL = "DEMO SAMPLE — NOT GENERATED FROM THIS WORKPLACE";

export type GenerateDraftRequest = {
  draftId: string;
  templateId: string;
  templateVersion: number;
  workplaceName: string;
  media: Array<{ storagePath: string; mimeType: string; frameTimeMs?: number }>;
  trainerInstructions: string;
  locale: string;
  // Pinned at request start; the server answers 409 when the draft moved on,
  // so a late result can never overwrite newer trainer edits.
  expectedRevision?: number;
  expectedHash?: string;
};

export type GenerateDraftSuccess = {
  draft: unknown;
  modelId: string;
  cached: boolean;
};

export async function generateTrainingDraft(
  supabaseUrl: string,
  accessToken: string,
  body: GenerateDraftRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<GenerateDraftSuccess> {
  const response = await fetchImpl(`${supabaseUrl}/functions/v1/generate-training-draft`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `Draft generation failed (${response.status})`);
  }
  return (await response.json()) as GenerateDraftSuccess;
}
