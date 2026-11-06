# Facebook Page Connection Setup

The connection page lets an authorized district Page operator approve read access and select one Facebook Page for an Obo pilot. Successful connections are saved with `status: "pending_review"` and `collectionEnabled: false`. Starting collection requires a separate pilot decision and integration. This flow does not update the source catalog or deployment schedule.

The public entrypoint is `/connect/facebook` on your deployed instance. Replace `https://example.org` in this guide with that instance's origin, and use its Meta app and hosting project.

## Configure the Meta App

Open your app in the [Meta app dashboard](https://developers.facebook.com/apps/) and configure the login flow for the intended deployment origin. Register these URLs with your own origin:

| Purpose | URL |
| --- | --- |
| Connection page | `https://example.org/connect/facebook` |
| Valid OAuth redirect URI | `https://example.org/api/integrations/facebook/callback` |
| Privacy information | `https://example.org/connect/facebook/privacy` |
| Deauthorization callback | `https://example.org/api/integrations/facebook/deauthorize` |
| Data deletion callback | `https://example.org/api/integrations/facebook/deletion` |

The standard authorization-code flow requests `pages_show_list` and `pages_read_engagement`. The server exchanges the authorization code, requests an extended user token, verifies both granted permissions, and lists available Pages. After selection, it obtains that Page's token and verifies read access with a bounded request for published-post IDs.

If the app uses Facebook Login for Business, set `FACEBOOK_LOGIN_CONFIG_ID` to its numeric configuration ID. Configure a **user access token** flow with the same Page read permissions in the Meta dashboard. With this setting, the login URL supplies `config_id` instead of a `scope` parameter. The server still verifies the granted permissions. System-user token configurations are outside this implementation's authorization-code flow.

Test first with a Facebook user who has an app role and manages the test Page. Before inviting an external Page operator, record the app dashboard's exact requirements for the selected login product, permission access levels, app mode, App Review, and business verification. Development access with an app-role user does not establish live access for an external admin. Confirm the permitted storage, display, and external AI processing separately before a content pilot.

## Server Environment

Set these variables in the intended Vercel environment and redeploy. Keep the app secret and Google credentials in protected server environment variables. Facebook configuration has no `NEXT_PUBLIC_` credential variables.

| Variable | Required | Value |
| --- | --- | --- |
| `FACEBOOK_APP_ID` | Yes | Your numeric Meta app ID |
| `FACEBOOK_APP_SECRET` | Yes | The app secret from Meta, kept server-side |
| `FACEBOOK_GRAPH_API_VERSION` | Yes | Explicit version, such as the tested `v25.0` |
| `FACEBOOK_PAGE_TOKENS_SECRET` | Yes | Existing Secret Manager resource: `projects/<project>/secrets/<secret>` |
| `FACEBOOK_CONNECT_BASE_URL` | Optional | Your instance's origin, such as `https://example.org` |
| `FACEBOOK_LOGIN_CONFIG_ID` | Optional | Numeric Facebook Login for Business user-token configuration ID |

The origin defaults to `NEXT_PUBLIC_BASE_URL` when `FACEBOOK_CONNECT_BASE_URL` is absent. It must be an HTTPS origin with no path, query, or fragment. HTTP localhost is accepted for non-production development. The callback URI is derived from this origin and must match the value registered with Meta. Open the connection page on that same origin because form submissions require a matching `Origin` header.

Use an environment's own origin, Meta redirect registration, database credentials, and Secret Manager resource for preview testing. Keep the app secret consistent across the instances serving one connection flow.

Missing or invalid configuration disables the connection button and shows a preparation message. The page remains available to explain the flow.

### Rotate the App Secret

`FACEBOOK_APP_SECRET` derives separate keys for temporary-token encryption and the HMAC operator identifier through HKDF. Changing it prevents existing encrypted sessions from being read and changes the operator hashes used to find connections. A valid Meta deletion callback checked with the new secret cannot automatically locate records written with the previous hash key.

Before replacing the secret, pause new connections and destroy the existing connector credential versions, then remove their connection and session metadata. Reconnect affected Pages after deploying the new configuration. An alternative requires an explicit, tested migration that keeps existing records reachable by revocation and deletion requests. The current connector has no automatic key migration. Record the cleanup or migration result before completing the rotation.

## Provision Credential Storage

Enable the Secret Manager API and create one dedicated secret before enabling the connection flow. Set `FACEBOOK_PAGE_TOKENS_SECRET` to the secret's resource name without `/versions/...`. The application adds versions to this existing secret.

The web server uses `FIREBASE_SERVICE_ACCOUNT_KEY` when configured and otherwise uses Google Application Default Credentials. Grant its service account these permissions **on this secret**:

| Permission | Use |
| --- | --- |
| `secretmanager.versions.add` | Save a Page credential as a new version |
| `secretmanager.versions.get` | Check version state during retirement retries |
| `secretmanager.versions.disable` | Disable a credential version |
| `secretmanager.versions.destroy` | Destroy a credential version after disconnection or failed setup |

The predefined `roles/secretmanager.secretVersionManager` covers these operations and also includes version creation. `roles/secretmanager.secretVersionAdder` alone needs additional get/disable/destroy permissions. A custom role containing the four required permissions provides a narrower grant. Scope either approach to the dedicated secret. A future collector that reads token payloads needs `roles/secretmanager.secretAccessor`; the connection writer uses version metadata rather than payload reads. See [Secret Manager IAM roles](https://docs.cloud.google.com/iam/docs/roles-permissions/secretmanager).

Each connection owns a separate secret version. Its database record stores that exact version reference. A future collector must use the connection's reference rather than the secret's `latest` alias, because one secret can contain credentials for several Pages.

## Configure Database Expiry

Connection state goes through `@oboapp/db` using the configured backend or dual-write adapters. The main collections are:

| Collection | Stored purpose | Retention |
| --- | --- | --- |
| `facebookOAuthSessions` | Browser-bound authorization state, encrypted temporary user token, Page choices, connection result, or token-free cleanup intent | Ordinary sessions have 15-minute logical validity and asynchronous physical expiry; unresolved cleanup intents remain until resolved |
| `facebookOAuthStartLimits` | Hashed start-limit key and request-window counter | Until its request window expires, followed by asynchronous physical expiry |
| `facebookUserRevocations` | Keyed operator hash and revocation time used to reject older in-flight sessions | A 30-minute expiry target plus asynchronous physical expiry |
| `facebookPageConnections` | Selected Page ID/name, keyed operator hash, secret-version reference, creation time, and pending or revoked status | Until credential destruction and metadata cleanup succeed |
| `facebookDeletionReceipts` | Opaque confirmation-code document ID and completion time | Retained as the deletion receipt |

`expiresAt` is an integer in milliseconds used for application checks. The session is rejected after 15 minutes even if its database document still exists. The storage-only `expireTime` field is a native date for database expiry policies. Configure cleanup on `expireTime` for all three temporary collections.

Before credential creation, a saving session clears its temporary token and Page list, retains the connection ID/name and operator hash, and sets `expireTime: null`. This token-free cleanup intent survives uncertain credential creation or failed retirement. Confirmed success or confirmed cleanup restores the date-based expiry. Keep unresolved intents until reconciliation confirms that their credential versions have been retired.

For Firestore, enable a TTL policy on `expireTime` in each collection group: `facebookOAuthSessions`, `facebookOAuthStartLimits`, and `facebookUserRevocations`. Use the actual database ID, including a named database if configured. Confirm all three policies are active. Firestore TTL requires a date/time value and deletes asynchronously. Do not attach the policy to numeric `expiresAt`. See [Firestore TTL policies](https://firebase.google.com/docs/firestore/ttl).

For MongoDB, create a single-field ascending TTL index on `expireTime` with `expireAfterSeconds: 0` in all three temporary collections. Confirm the stored field is a BSON date. MongoDB also removes expired documents asynchronously. See [MongoDB TTL indexes](https://www.mongodb.com/docs/manual/core/index-ttl/).

Configure expiry for every enabled backend when dual-write is active. Deployment of the web code does not create these policies or indexes. Existing ordinary temporary records without `expireTime` need an explicit backfill or cleanup before relying on TTL. Preserve `expireTime: null` on unresolved cleanup intents.

## Routes and Stored State

| Method | Route | Behavior |
| --- | --- | --- |
| `GET` | `/connect/facebook` | Show preparation, consent, Page selection, connection, or a known error state |
| `POST` | `/api/integrations/facebook/start` | Require `consent=yes`, apply the start limit, create a browser-bound session, and redirect to Meta |
| `GET` | `/api/integrations/facebook/callback` | Validate browser session and OAuth state, exchange the code, and prepare Page selection |
| `POST` | `/api/integrations/facebook/select` | Validate the session, `csrf`, and chosen `pageId`; verify access and save the pending connection |
| `GET` | `/connect/facebook/privacy` | Explain data use, retention, and disconnection |
| `POST` | `/api/integrations/facebook/deauthorize` | Verify Meta's signed request and remove that operator's connections and credentials |
| `POST` | `/api/integrations/facebook/deletion` | Verify Meta's signed request, perform deletion, and return a confirmation code and status URL |
| `GET` | `/connect/facebook/deletion?code=...` | Show whether the opaque deletion receipt exists |

The production cookie is `__Host-obo-facebook-connect`; development uses `obo-facebook-connect`. Both are HTTP-only, host-only, use `SameSite=Lax`, and have `Path=/`. The production cookie is secure; development also sets `Secure` when its configured origin uses HTTPS. Browser forms contain Page IDs, names, and the selection CSRF value. The Page access token stays server-side. Temporary user tokens are encrypted, and the persistent operator identifier is a keyed hash used to match verified revocation and deletion requests.

Completing selection clears the temporary token and Page list. Verified deauthorization or deletion first records a short-lived operator revocation marker, which prevents an older in-flight session from saving a new connection. A request that encounters a session still saving or an unresolved cleanup intent returns a retryable failure rather than a completion receipt.

Cleanup tracks the connection as `revoked`, attempts credential destruction, and falls back to disabling the version if destruction fails. Its metadata stays available until destruction and removal succeed. A deletion receipt is created only after all matching cleanup succeeds and contains its opaque code and completion time.

### Recover Incomplete Cleanup

A failed callback returns an error for retry. Inspect retained `revoked` records in `facebookPageConnections` and token-free cleanup intents in `facebookOAuthSessions`. Confirm their exact credential versions are destroyed, then complete metadata removal. Keep unresolved cleanup records outside TTL deletion.

If credential creation has an uncertain result, or database tracking and cloud cleanup fail together, a credential version may need manual reconciliation. Its protected envelope includes `connectionId`, `userHash`, Page ID, and connection time for this purpose. An authorized operator with separately scoped payload-read access can correlate the version with the connection intent and retire it. Remove a retained intent only after that reconciliation is complete. Keep the envelope out of logs and reports. There is no automatic orphan reconciler, so record the outcome before considering that failed connection or deletion request resolved.

## Validate Before Sharing the Link

1. Deploy the intended code and environment to the configured origin. Check that the preparation message is replaced by an enabled connection flow.
2. Use an app-role account to grant the two read permissions and select a test Page. Verify the saved record is `pending_review`, `collectionEnabled` is `false`, and its secret version belongs to the dedicated secret.
3. Check cancellation, expired sessions, denied permissions, an invalid selection, and storage failure. Shared errors must stay human-readable and free of credentials.
4. Confirm database expiry policies are active and temporary records use native date values in `expireTime`.
5. Remove the integration in Facebook and verify the signed callback removes its connection and credential. Exercise the data-deletion callback and its confirmation URL as well.
6. Confirm the external-admin and live-access requirements in the Meta dashboard before inviting Oborishte. Keep content collection disabled until the isolated pilot environment and its operating plan are approved.

Never copy app secrets, access tokens, signed provider requests, raw paging URLs, or signed media URLs into reports, fixtures, issue comments, or screenshots. Use the [pilot tracker](https://github.com/oboapp/oboapp/issues/662) to record sanitized evidence and remaining gates.
