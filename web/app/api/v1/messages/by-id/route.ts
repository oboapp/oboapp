import { NextResponse } from "next/server";
import { validateApiKey, apiKeyUnauthorizedResponse } from "@/lib/withApiKey";
import { GET as getMessageById } from "@/app/api/messages/by-id/route";
import { v1Schemas } from "@/lib/v1-api-schema";

export async function GET(request: Request) {
  if (!(await validateApiKey(request))) {
    return apiKeyUnauthorizedResponse();
  }
  const internal = await getMessageById(request);
  if (!internal.ok) return internal;
  const parsed = v1Schemas.messageResponse.safeParse(await internal.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Internal response parsing error" },
      { status: 500 },
    );
  }
  return NextResponse.json(parsed.data);
}
