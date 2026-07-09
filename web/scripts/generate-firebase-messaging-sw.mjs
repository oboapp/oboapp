import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const webRoot = dirname(scriptDir);
const templatePath = join(scriptDir, "firebase-messaging-sw.template.js");
const outputPath = join(webRoot, "public", "firebase-messaging-sw.js");

function inferRuntimeEnv() {
  if (process.env.NODE_ENV) {
    return process.env.NODE_ENV;
  }

  const lifecycleEvent = process.env.npm_lifecycle_event ?? "";
  if (lifecycleEvent === "predev" || lifecycleEvent === "dev") {
    return "development";
  }

  if (lifecycleEvent === "prebuild" || lifecycleEvent === "build") {
    return "production";
  }

  if (lifecycleEvent === "prestart" || lifecycleEvent === "start") {
    return "production";
  }

  return "development";
}

function loadNextStyleEnv() {
  const nodeEnv = inferRuntimeEnv();
  const envFiles = [
    `.env.${nodeEnv}.local`,
    ".env.local",
    `.env.${nodeEnv}`,
    ".env",
  ];

  for (const envFile of envFiles) {
    dotenv.config({ path: join(webRoot, envFile), override: false });
  }
}

const requiredConfigEnv = {
  apiKey: "NEXT_PUBLIC_FIREBASE_API_KEY",
  authDomain: "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN",
  projectId: "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
  storageBucket: "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID",
  appId: "NEXT_PUBLIC_FIREBASE_APP_ID",
};

function readFirebaseConfigFromEnv() {
  const config = {};
  const missing = [];

  for (const [configKey, envKey] of Object.entries(requiredConfigEnv)) {
    const value = process.env[envKey]?.trim();
    if (!value) {
      missing.push(envKey);
      continue;
    }
    config[configKey] = value;
  }

  return {
    config: missing.length > 0 ? null : config,
    missing,
  };
}

function generateServiceWorker() {
  loadNextStyleEnv();

  const template = readFileSync(templatePath, "utf8");
  const { config, missing } = readFirebaseConfigFromEnv();

  const rendered = template.replace(
    "__FIREBASE_CONFIG_JSON__",
    config ? JSON.stringify(config, null, 2) : "null",
  );

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, rendered, "utf8");

  if (missing.length > 0) {
    console.warn(
      `[generate-firebase-messaging-sw] Firebase messaging config missing (${missing.join(", ")}). Generated service worker will skip Firebase Messaging initialization.`,
    );
    return;
  }

  console.log(
    "[generate-firebase-messaging-sw] Generated firebase-messaging-sw.js from environment config.",
  );
}

generateServiceWorker();
