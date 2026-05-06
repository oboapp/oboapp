import { NextResponse } from "next/server";
import { validateApiKey, apiKeyUnauthorizedResponse } from "@/lib/withApiKey";
import { GET as getMessages } from "@/app/api/messages/route";
import { v1Schemas } from "@/lib/v1-api-schema";

export async function GET(request: Request) {
  if (!(await validateApiKey(request))) {
    return apiKeyUnauthorizedResponse();
  }
  const internal = await getMessages(request);
  if (!internal.ok) return internal;
  const parsed = v1Schemas.messagesResponse.safeParse(await internal.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Internal response parsing error" },
      { status: 500 },
    );
  }
  return NextResponse.json(parsed.data);
}
