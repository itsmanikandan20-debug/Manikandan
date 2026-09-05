// Reverse-image search APIs need a public URL, not a raw file, so the
// uploaded screenshot is briefly hosted on imgbb before being searched.
// NOTE: this makes the screenshot reachable at a random public URL —
// see README.md "Privacy note" before using this with confidential designs.

const IMGBB_UPLOAD_URL = "https://api.imgbb.com/1/upload";

export async function uploadImageForSearch(buffer: Buffer, mimeType: string): Promise<string> {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) throw new Error("IMGBB_API_KEY is not set");

  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(buffer)], { type: mimeType }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(`${IMGBB_UPLOAD_URL}?key=${apiKey}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    const json = await res.json();
    if (!res.ok || !json?.data?.url) {
      throw new Error(json?.error?.message ?? `imgbb upload failed (${res.status})`);
    }
    return json.data.url as string;
  } finally {
    clearTimeout(timeout);
  }
}
