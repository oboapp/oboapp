import { NextResponse } from "next/server";
import { verifyFacebookSignedRequest } from "./crypto";
import { facebookPrivateHeaders, readFacebookForm } from "./http";
import {
  deleteFacebookUserConnections,
  FacebookConnectionFlowError,
  getFacebookConnectionContext,
} from "./service";

export async function handleFacebookDeletion(request: Request): Promise<NextResponse> {
  try {
    const context = await getFacebookConnectionContext();
    const form = await readFacebookForm(request);
    const signed = verifyFacebookSignedRequest(context.config, form.get("signed_request") || "");
    if (!signed) {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: facebookPrivateHeaders });
    }
    const confirmationCode = await deleteFacebookUserConnections(context, signed.userId);
    const url = new URL("/connect/facebook/deletion", context.config.origin);
    url.searchParams.set("code", confirmationCode);
    return NextResponse.json({ url: url.toString(), confirmation_code: confirmationCode }, {
      headers: facebookPrivateHeaders,
    });
  } catch (error) {
    if (error instanceof FacebookConnectionFlowError && error.code === "invalid") {
      return NextResponse.json({ error: "invalid_request" }, { status: 400, headers: facebookPrivateHeaders });
    }
    return NextResponse.json({ error: "temporarily_unavailable" }, { status: 503, headers: facebookPrivateHeaders });
  }
}
