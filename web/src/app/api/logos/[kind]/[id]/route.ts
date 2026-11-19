import { NextResponse } from "next/server";
import { getLogoSvgForApi, renderSvgDocument } from "@/lib/logos-server";

const SAFE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ kind: string; id: string }> },
) {
  const { kind, id } = await context.params;
  if ((kind !== "model" && kind !== "tool") || !SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const svg = await getLogoSvgForApi(kind, id);
  if (!svg) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  return new NextResponse(renderSvgDocument(svg), {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
