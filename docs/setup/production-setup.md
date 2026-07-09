# Production Setup Guide

Set up oboapp with real Firebase/Google Cloud Platform infrastructure for production deployment or realistic testing.

## Prerequisites

- Google Cloud Platform account
- Firebase project
- Domain name (for production deployment)

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Enter project name: `oboapp-prod` (or your choice)
4. Enable Google Analytics (optional)
5. Create project

## Step 2: Enable Firebase Services

### Firestore Database

1. In Firebase Console → **Build** → **Firestore Database**
2. Click **Create database**
3. Select location: `europe-north2` (or closest to users)
4. Start in **production mode**

### Authentication

1. In Firebase Console → **Build** → **Authentication**
2. Click **Get started**
3. Enable **Google** sign-in provider
4. Add authorized domains for your app

### Cloud Messaging (Optional - for notifications)

1. In Firebase Console → **Build** → **Messaging**
2. Click **Get started**
3. Follow setup wizard
4. Generate VAPID key (Settings → Cloud Messaging → Web Push certificates)

## Step 3: Create Service Account

See detailed instructions: [Firebase Service Account Setup](../setup/firebase-service-account-setup.md)

1. In Firebase Console → **Project Settings** → **Service Accounts**
2. Click **Generate new private key**
3. Download JSON file (keep it secret!)
4. Convert to single line:
   ```bash
   jq -c . < service-account-key.json
   ```

## Step 4: Enable Google Cloud APIs

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your Firebase project
3. Navigate to **APIs & Services** → **Enable APIs and Services**

Enable these APIs:

- ✅ **Maps JavaScript API** - For map display
- ✅ **Geocoding API** - For address to coordinates conversion
- ✅ **Generative Language API** - For Gemini AI (message categorization)

## Step 5: Create API Keys

### Google Maps API Key

1. In Google Cloud Console → **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **API key**
3. Copy the key
4. Click **Edit API key** → **API restrictions**
5. Select **Restrict key** → Choose:
   - Maps JavaScript API
   - Geocoding API
6. Add **Application restrictions**:
   - HTTP referrers: `https://yourdomain.com/*`, `http://localhost:3000/*`

### Google AI API Key (Gemini)

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Click **Create API Key**
3. Select your Firebase/GCP project
4. Copy the key

## Step 6: Deploy Firestore Indexes

```bash
cd ingest
firebase login
firebase use <your-project-id>
firebase deploy --only firestore:indexes
```

Wait 5-15 minutes for indexes to build. Check status in Firebase Console → Firestore → Indexes.

**Critical:** App will fail with cryptic errors if indexes aren't built.

## Step 7: Configure Environment Variables

### Ingest Module (`ingest/.env.local`)

```dotenv
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id

# Firebase Admin SDK Service Account
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}

# Google Maps API Key
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_maps_api_key

# Google Gemini AI
GOOGLE_AI_API_KEY=your_gemini_api_key
GOOGLE_AI_MODEL=gemini-2.5-flash-lite

# App URL (production)
NEXT_PUBLIC_APP_URL=https://yourdomain.com

# Keep mocks disabled
# MOCK_GEMINI_API=false
# MOCK_GOOGLE_GEOCODING=false
# USE_FIREBASE_EMULATORS=false
```

### Web Module (`web/.env.local`)

```dotenv
# Firebase Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

# Google Maps API Key
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_maps_api_key

# Firebase Admin SDK Service Account
FIREBASE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}

# Firebase Cloud Messaging (optional)
NEXT_PUBLIC_FIREBASE_VAPID_KEY=your_vapid_key

# Base URL (production)
NEXT_PUBLIC_BASE_URL=https://yourdomain.com

# Public API host (required to support legacy /api/v1 redirects from web)
# If unset, web starts but /api/v1 requests return 500.
PUBLIC_API_HOST=https://api.yourdomain.com

# Keep emulators disabled
# NEXT_PUBLIC_USE_FIREBASE_EMULATORS=false
```

If you enable push notifications, all Firebase web config values above plus `NEXT_PUBLIC_FIREBASE_VAPID_KEY` must be set. At startup/build, the web app generates the messaging service worker from these variables. When required values are missing, background push messaging is disabled by design.

Get Firebase config values from: **Firebase Console → Project Settings → General → Your apps → Web app**

## Step 8: Run Application

### Ingest Module (Data Pipeline)

```bash
cd ingest
pnpm install
pnpm crawl --source sofiyska-voda
pnpm ingest
pnpm notify
```

### Web Application

```bash
cd web
pnpm install
pnpm dev  # Development
pnpm build && pnpm start  # Production
```

## Deployment

### Ingest Pipeline (Google Cloud Run)

The ingest module is containerized for deployment to Google Cloud Run:

```bash
cd ingest
docker build -t gcr.io/your-project-id/oboapp-ingest .
docker push gcr.io/your-project-id/oboapp-ingest
gcloud run deploy oboapp-ingest --image gcr.io/your-project-id/oboapp-ingest
```

See `ingest/terraform/` for infrastructure-as-code deployment.

### Web Application (Next.js)

```bash
pnpm --filter web build
pnpm --filter web start
```

The web app is a standard Next.js application and can be deployed on any host that supports Node.js or a Next.js build output (for example, a managed Next.js platform, a self-hosted Node.js server, or a Docker container). Configure the required environment variables in your host's environment/secrets settings.

## Monitoring and Maintenance

### Check Firestore Indexes

Firebase Console → Firestore → Indexes

Status should be "Enabled" for all indexes.

### Monitor API Quota

Google Cloud Console → APIs & Services → Quotas

Watch for:

- Maps JavaScript API requests
- Geocoding API requests
- Gemini AI requests

### Check Cloud Run Logs

Google Cloud Console → Cloud Run → Select job → Logs

Filter by error severity for issues.

## Cost Estimates

Example profile (Sofia deployment):

| Service             | Free Tier      | Typical Monthly Cost |
| ------------------- | -------------- | -------------------- |
| Firestore           | 50K reads/day  | $1-5                 |
| Cloud Run           | 2M requests    | $0-2                 |
| Geocoding API       | $200 credit/mo | $0-10                |
| Maps JavaScript API | $200 credit/mo | $0                   |
| Gemini AI           | Free tier      | $0-5                 |
| **Total**           | -              | **$1-22/month**      |

Actual cost depends on your configured locality, traffic volume, crawler set, and schedule profile.

For adapting configuration for another city/locality, see [Deploying oboapp for a New City](new-locality-instance.md).

## Troubleshooting

### "Permission denied" errors

**Cause:** Firestore security rules block client writes

**Solution:** All writes must go through API routes using Firebase Admin SDK

### "Index not found" errors

**Cause:** Firestore indexes not deployed or still building

**Solution:** Run `firebase deploy --only firestore:indexes` and wait

### "Quota exceeded" errors

**Cause:** Exceeded free tier limits

**Solution:** Enable billing in Google Cloud Console or reduce API calls

### Geocoding returns wrong locations

**Cause:** API key restrictions too broad

**Solution:** Restrict Maps API key to specific HTTP referrers

## Next Steps

- [External API Mocks](../features/external-api-mocks.md) - Test locally without API costs
- [Quick Start with Emulators](quick-start-emulators.md) - Development without cloud setup
- [Contributing Guide](../../CONTRIBUTING.md) - Submit improvements
