import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const expected = JSON.parse(await readFile("/app/contest-assets/content.json", "utf8"));
const checksums = JSON.parse(await readFile("/app/contest-assets/manifest.json", "utf8"));
const get = async (url) => { const r = await fetch("http://127.0.0.1:3101" + url); if (!r.ok) throw Error(url + ": " + r.status); return r; };
const docs = await (await get("/api/documents")).json();
const partners = await (await get("/api/partners")).json();
const faq = await (await get("/api/faq")).json();
if (docs.items.length !== expected.documents.length || partners.length !== expected.partners.length || faq.items.length !== expected.faq.length) throw Error("Public content count mismatch");
let checked = 0;
for (const doc of docs.items) {
  const original = expected.documents.find((row) => row.id === doc.id);
  const bytes = Buffer.from(await (await get(doc.fileUrl)).arrayBuffer());
  if (!original || createHash("sha256").update(bytes).digest("hex") !== checksums[original.fileName]) throw Error("Document content mismatch");
  checked++;
}
for (const partner of partners) for (const media of partner.media) {
  const original = expected.images.find((row) => row.id === media.imageAttachmentId);
  const bytes = Buffer.from(await (await get(media.imageUrl)).arrayBuffer());
  if (!original || createHash("sha256").update(bytes).digest("hex") !== checksums[original.fileName]) throw Error("Partner media mismatch");
  checked++;
}
if (checked !== expected.documents.length + expected.media.length) throw Error("Media count mismatch");
console.log("Verified public files:", checked);
