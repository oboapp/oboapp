import { NextRequest, NextResponse } from "next/server";

export function middleware(_request: NextRequest) {
  return new NextResponse(null, { status: 410 });
}

export const config = {
  matcher: ["/air-quality", "/air-quality/:path*"],
};
