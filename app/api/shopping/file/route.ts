import { NextRequest } from "next/server";
import { createReadStream, existsSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { Readable } from "node:stream";
import { refDir } from "@/lib/shopping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};

/** refs/<키워드>/<name> 파일 서빙(영상 시킹용 Range 지원). */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const keyword = searchParams.get("keyword");
  const name = basename(searchParams.get("name") || "short.mp4"); // traversal 방지
  if (!keyword) return new Response("keyword 필요", { status: 400 });

  const file = join(refDir(keyword), name);
  if (!existsSync(file)) return new Response("파일 없음", { status: 404 });

  const size = statSync(file).size;
  const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
  const type = TYPES[ext] || "application/octet-stream";
  const range = req.headers.get("range");

  if (range) {
    const m = range.match(/bytes=(\d+)-(\d*)/);
    const start = m ? parseInt(m[1], 10) : 0;
    const end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    const nodeStream = createReadStream(file, { start, end });
    return new Response(Readable.toWeb(nodeStream) as unknown as ReadableStream, {
      status: 206,
      headers: {
        "content-type": type,
        "content-range": `bytes ${start}-${end}/${size}`,
        "accept-ranges": "bytes",
        "content-length": String(end - start + 1),
      },
    });
  }

  return new Response(Readable.toWeb(createReadStream(file)) as unknown as ReadableStream, {
    headers: {
      "content-type": type,
      "content-length": String(size),
      "accept-ranges": "bytes",
    },
  });
}
