import express from "express";
import { Readable } from "stream";

const app = express();
const PORT = 3000;

const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const TEXT_TYPES = [
  /^text\//,
  /^application\/json$/,
  /^application\/xml$/,
  /^application\/javascript$/
];

const IMAGE_TYPES = [
  /^image\//
];

app.use(express.urlencoded({ extended: true }));

/* ---------- UI ---------- */

function page(content) {
  return `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet"
      href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <script>hljs.highlightAll();</script>
  </head>
  <body class="bg-gray-100 min-h-screen">
    <div class="max-w-5xl mx-auto p-6">
      ${content}
    </div>
  </body>
  </html>
  `;
}

/* ---------- Home ---------- */

app.get("/", (req, res) => {
  res.send(page(`
    <div class="bg-white p-6 rounded-xl shadow">
      <h1 class="text-2xl font-bold mb-4">URL Viewer</h1>
      <form method="POST" action="/fetch" class="space-y-4">
        <input
          name="url"
          required
          placeholder="Enter a file or image URL"
          class="w-full border p-2 rounded"
        />
        <button class="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">
          Fetch
        </button>
      </form>
      <p class="text-sm text-gray-500 mt-4">
        Supports text/code + images • Max size 10 MB
      </p>
    </div>
  `));
});

/* ---------- Fetch metadata + text ---------- */

app.post("/fetch", async (req, res) => {
  const { url } = req.body;

  try {
    const response = await fetch(url, { redirect: "follow" });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const contentLength = response.headers.get("content-length");

    if (contentLength && Number(contentLength) > MAX_SIZE) {
      throw new Error("File exceeds 10 MB limit");
    }

    const isText = TEXT_TYPES.some(rx => rx.test(contentType));
    const isImage = IMAGE_TYPES.some(rx => rx.test(contentType));

    if (!isText && !isImage) {
      throw new Error(`Unsupported content-type: ${contentType}`);
    }

    /* ---------- Image: use streaming proxy ---------- */
    if (isImage) {
      return res.send(page(`
        <div class="bg-white p-6 rounded-xl shadow">
          <h2 class="text-xl font-bold mb-2">Image Preview</h2>
          <p class="text-sm text-gray-600 mb-4">${contentType}</p>
          <img
            src="/image?url=${encodeURIComponent(url)}"
            class="max-w-full rounded border"
          />
          <div class="mt-4">
            <a href="/" class="text-blue-600 hover:underline">← Back</a>
          </div>
        </div>
      `));
    }

    /* ---------- Text / code ---------- */

    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      received += value.length;
      if (received > MAX_SIZE) {
        throw new Error("File exceeds 10 MB limit");
      }

      chunks.push(value);
    }

    const text = Buffer.concat(chunks).toString("utf-8");

    res.send(page(`
      <div class="bg-white p-6 rounded-xl shadow">
        <h2 class="text-xl font-bold mb-2">File Content</h2>
        <p class="text-sm text-gray-600 mb-4">${contentType}</p>
        <pre class="overflow-x-auto rounded"><code>${escapeHtml(text)}</code></pre>
        <div class="mt-4">
          <a href="/" class="text-blue-600 hover:underline">← Back</a>
        </div>
      </div>
    `));

  } catch (err) {
    res.send(page(`
      <div class="bg-white p-6 rounded-xl shadow">
        <h2 class="text-xl font-bold text-red-600">Error</h2>
        <p class="mt-2">${escapeHtml(err.message)}</p>
        <a href="/" class="text-blue-600 hover:underline mt-4 inline-block">← Back</a>
      </div>
    `));
  }
});

/* ---------- Streaming Image Proxy ---------- */

app.get("/image", async (req, res) => {
  const { url } = req.query;

  if (!url) {
    return res.status(400).send("Missing url");
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      return res.sendStatus(404);
    }

    const contentType = response.headers.get("content-type") || "";

    if (!IMAGE_TYPES.some(rx => rx.test(contentType))) {
      return res.sendStatus(415);
    }

    res.setHeader("Content-Type", contentType);

    let transferred = 0;
    const reader = response.body.getReader();

    const stream = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }

        transferred += value.length;
        if (transferred > MAX_SIZE) {
          this.destroy(new Error("Image exceeds 10 MB limit"));
          return;
        }

        this.push(Buffer.from(value));
      }
    });

    stream.pipe(res);

  } catch {
    res.sendStatus(500);
  }
});

/* ---------- Utils ---------- */

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});