import { describe, expect, it } from "vitest";
import {
  mediaBelongsToDraft,
  validateDraftIdentity,
  type DraftRequest,
} from "../functions/_shared/generate-draft-helpers.js";

const request: DraftRequest = {
  draftId: "00000000-0000-4000-8000-000000000001",
  templateId: "fire-safety-induction",
  templateVersion: 1,
  workplaceName: "Mine A",
  media: [],
  trainerInstructions: "",
  locale: "en-IN",
};

describe("draft generation security boundaries", () => {
  it("rejects model output that changes draft or template identity", () => {
    expect(validateDraftIdentity({ draftId: request.draftId, templateId: request.templateId, templateVersion: 1 }, request)).toEqual([]);
    expect(validateDraftIdentity({ draftId: "other", templateId: request.templateId, templateVersion: 1 }, request)).toContain(
      "draftId does not match the requested draft.",
    );
    expect(validateDraftIdentity({ draftId: request.draftId, templateId: "other", templateVersion: 1 }, request)).toContain(
      "templateId does not match the requested template.",
    );
  });

  it("allows only media beneath the caller organization and exact draft", () => {
    const org = "00000000-0000-4000-8000-000000000010";
    expect(mediaBelongsToDraft([{ storagePath: `${org}/${request.draftId}/photo.jpg`, mimeType: "image/jpeg" }], org, request.draftId)).toBe(true);
    expect(mediaBelongsToDraft([{ storagePath: `other-org/${request.draftId}/photo.jpg`, mimeType: "image/jpeg" }], org, request.draftId)).toBe(false);
    expect(mediaBelongsToDraft([{ storagePath: `${org}/other-draft/photo.jpg`, mimeType: "image/jpeg" }], org, request.draftId)).toBe(false);
  });
});
