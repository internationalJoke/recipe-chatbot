import { NextResponse } from "next/server";
import { STORE_IDS, type StoreId } from "@/lib/stores/axfood";
import { getStoreLogo } from "@/lib/stores/logos";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ store: string }> };

// Serves a store logo from our database. The CSP sandbox stops scripts inside an SVG
// from running if someone opens this URL directly.
export async function GET(_request: Request, { params }: RouteContext) {
  const { store } = await params;
  if (!STORE_IDS.includes(store as StoreId)) {
    return NextResponse.json({ error: "Unknown store" }, { status: 404 });
  }

  try {
    const logo = await getStoreLogo(store as StoreId);
    if (!logo) return NextResponse.json({ error: "Logo not available" }, { status: 404 });
    return new Response(Buffer.from(logo.data), {
      headers: {
        "Content-Type": logo.mimeType,
        "Cache-Control": "public, max-age=86400",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Could not load store logo:", { store, error });
    return NextResponse.json({ error: "Logo not available" }, { status: 500 });
  }
}
