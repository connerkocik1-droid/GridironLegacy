"use client";

/**
 * PUTs a file to a signed storage URL, reporting how far it has got.
 *
 * Supabase's own uploadToSignedUrl does the same request but says nothing
 * until it is finished, which is fine for a crest and useless for a film: a
 * commissioner watching "Uploading…" for four minutes cannot tell a slow
 * upload from a stalled one. XMLHttpRequest is used rather than fetch because
 * it is still the only way in a browser to watch a request body go out.
 *
 * The caller keeps the library call as a fallback. This is a hand-written
 * request against somebody else's endpoint, and being able to fall back to the
 * client that is maintained alongside that endpoint is worth the few lines.
 */
export function uploadWithProgress(
  signedUrl: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", signedUrl, true);
    request.setRequestHeader("content-type", file.type || "application/octet-stream");

    request.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };

    request.onload = () => {
      if (request.status >= 200 && request.status < 300) return resolve();

      // Storage explains its own refusals — a file over the project's limit
      // says so — and that explanation is more use than anything made up here.
      let detail = "";
      try {
        const body = JSON.parse(request.responseText);
        detail = body?.message ?? body?.error ?? "";
      } catch {
        detail = request.responseText?.slice(0, 200) ?? "";
      }

      reject(new Error(detail || `The upload was refused (${request.status}).`));
    };

    request.onerror = () => reject(new Error("The connection dropped during the upload."));
    request.onabort = () => reject(new Error("The upload was cancelled."));

    request.send(file);
  });
}
