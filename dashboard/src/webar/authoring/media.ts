// Trainer media staging: validation + authorized upload.
// Browser never sees service-role or OpenRouter secrets. Uploads go to the
// org-scoped path in the `training-media` bucket through the authenticated
// Supabase client. Bucket provisioning is a live-environment follow-up.
export const ALLOWED_MEDIA_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "video/mp4",
] as const;

export const MAX_MEDIA_FILES = 10;
export const MAX_MEDIA_BYTES_PER_FILE = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 60;

export type StagedMedia = {
  name: string;
  mimeType: string;
  bytes: number;
  file?: File;
};

export function validateMediaFiles(files: Array<{ name: string; type: string; size: number }>): string[] {
  const errors: string[] = [];
  if (files.length === 0) errors.push("Add at least one workplace photo or a short video.");
  if (files.length > MAX_MEDIA_FILES) errors.push(`At most ${MAX_MEDIA_FILES} files are supported for P0.`);
  for (const f of files) {
    if (!(ALLOWED_MEDIA_MIME as readonly string[]).includes(f.type)) {
      errors.push(`${f.name}: MIME ${f.type || "unknown"} is not allowed.`);
    }
    if (f.size > MAX_MEDIA_BYTES_PER_FILE) {
      errors.push(`${f.name}: larger than the 50 MB P0 limit.`);
    }
  }
  return errors;
}

export function stageMedia(files: FileList | File[]): StagedMedia[] {
  return [...files].map((f) => ({ name: f.name, mimeType: f.type, bytes: f.size, file: f }));
}

export type StorageClient = {
  upload: (path: string, body: File | Blob, opts: { contentType: string; upsert: boolean }) => Promise<{ error: Error | null }>;
};

export async function uploadTrainingMedia(
  storage: { from: (bucket: string) => StorageClient },
  organizationId: string,
  draftId: string,
  staged: StagedMedia[],
): Promise<Array<{ storagePath: string; mimeType: string }>> {
  const refs: Array<{ storagePath: string; mimeType: string }> = [];
  for (const [i, item] of staged.entries()) {
    if (!item.file) throw new Error(`${item.name}: file bytes missing; cannot upload`);
    const safeName = item.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${organizationId}/${draftId}/${i}-${safeName}`;
    const { error } = await storage
      .from("training-media")
      .upload(storagePath, item.file, { contentType: item.mimeType, upsert: false });
    if (error) throw new Error(`Upload failed for ${item.name}: ${error.message}`);
    refs.push({ storagePath, mimeType: item.mimeType });
  }
  return refs;
}
