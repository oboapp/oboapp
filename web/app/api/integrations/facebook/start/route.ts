import {
  facebookRedirect,
  readFacebookForm,
  requireFacebookSameOrigin,
} from "@/lib/facebook-connect/http";
import {
  FacebookConnectionFlowError,
  getFacebookConnectionContext,
  startFacebookConnection,
} from "@/lib/facebook-connect/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const context = await getFacebookConnectionContext();
    requireFacebookSameOrigin(request, context.config);
    const form = await readFacebookForm(request);
    if (form.get("consent") !== "yes") {
      throw new FacebookConnectionFlowError("invalid");
    }
    const network = request.headers.get("x-vercel-forwarded-for") ||
      request.headers.get("x-real-ip") || "unknown";
    const result = await startFacebookConnection(context, network.slice(0, 128));
    return facebookRedirect(request, result);
  } catch (error) {
    return facebookRedirect(request, { error, clearCookie: true });
  }
}
