// Explodes the data-URL blobs in src/data/*.state.json into real files under
// public/assets, plus a small index the loaders read instead of the blob.
import fs from "node:fs";
import path from "node:path";

const sources = [{ src: "src/data/logos.state.json", dir: "public/assets/logos" }];

for (const { src, dir } of sources) {
  fs.mkdirSync(dir, { recursive: true });
  const map = JSON.parse(fs.readFileSync(src, "utf8"));
  const index = {};

  for (const [key, value] of Object.entries(map)) {
    const m = /^data:image\/(\w+);base64,(.+)$/.exec(value);
    if (!m) {
      index[key] = value;
      continue;
    }
    const [, ext, b64] = m;
    const file = `${key.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.${ext}`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(b64, "base64"));
    index[key] = file;
  }

  fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(index, null, 2));
  console.log(dir, Object.keys(index).length, "entries");
}
