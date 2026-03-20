#!/usr/bin/env tsx
import dotenv from "dotenv";
import { resolve } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

// Load environment variables
dotenv.config({ path: resolve(process.cwd(), ".env.local") });

async function captureApiResponses() {
  console.log("🎬 Capturing API responses for fixture generation...\n");

  // Ensure mock mode is disabled
  process.env.MOCK_GEMINI_API = "false";
  process.env.MOCK_GOOGLE_GEOCODING = "false";
  process.env.MOCK_OVERPASS_API = "false";
  process.env.MOCK_CADASTRE_API = "false";

  // Dynamic imports to ensure dotenv loads first
  const { filterAndSplit, categorize, extractLocations } =
    await import("@/lib/ai-service");
  const { geocodeAddress } = await import("@/geocoding/google/service");
  const { overpassGeocodeAddresses } =
    await import("@/geocoding/overpass/service");
  const { geocodeCadastralProperty } =
    await import("@/geocoding/cadastre/service");

  // Create fixture directories
  const fixtureBase = resolve(__dirname, "../__mocks__/fixtures");
  mkdirSync(`${fixtureBase}/gemini`, { recursive: true });
  mkdirSync(`${fixtureBase}/google-geocoding`, { recursive: true });
  mkdirSync(`${fixtureBase}/overpass`, { recursive: true });
  mkdirSync(`${fixtureBase}/cadastre`, { recursive: true });

  // Capture Gemini filter & split responses
  console.log("📝 Capturing Gemini filter & split responses...");

  const waterText =
    "Спиране на водоснабдяването на бул. Витоша 1 поради авария.";
  const waterFilterResult = await filterAndSplit(waterText);
  writeFixture("gemini/filter-split-water.json", waterFilterResult);
  console.log("  ✓ Water disruption filter & split");

  const trafficText =
    "Затворен за движение булевард Мария Луиза от 8:00 до 18:00 часа.";
  const trafficFilterResult = await filterAndSplit(trafficText);
  writeFixture("gemini/filter-split-traffic.json", trafficFilterResult);
  console.log("  ✓ Traffic block filter & split");

  const constructionText =
    "Ремонт на метростанция на площад Македония до края на месеца.";
  const constructionFilterResult = await filterAndSplit(constructionText);
  writeFixture("gemini/filter-split-construction.json", constructionFilterResult);
  console.log("  ✓ Construction filter & split");

  // Capture Gemini categorization responses
  console.log("\n📝 Capturing Gemini categorization responses...");

  const waterCatResult = await categorize(waterText);
  writeFixture("gemini/categorize-water-disruption.json", waterCatResult);
  console.log("  ✓ Water disruption categorization");

  const trafficCatResult = await categorize(trafficText);
  writeFixture("gemini/categorize-traffic-block.json", trafficCatResult);
  console.log("  ✓ Traffic block categorization");

  const constructionCatResult = await categorize(constructionText);
  writeFixture("gemini/categorize-construction.json", constructionCatResult);
  console.log("  ✓ Construction categorization");

  // Capture Gemini extraction responses
  console.log("\n📝 Capturing Gemini extraction responses...");

  const extractText =
    "Спиране на водоснабдяването на бул. Витоша 1 и ул. Граф Игнатиев 15 от 10:00 до 16:00 часа на 15.02.2026г.";
  const extractResult = await extractLocations(extractText);
  writeFixture("gemini/extract-pins-streets.json", extractResult);
  console.log("  ✓ Pins and streets extraction");

  const extractUpiText =
    "Спиране на водоснабдяването в УПИ I-123, кв. 45, м. Средец от 09:00 до 17:00 на 20.02.2026г.";
  const extractUpiResult = await extractLocations(extractUpiText);
  writeFixture("gemini/extract-cadastral.json", extractUpiResult);
  console.log("  ✓ Cadastral property extraction");

  // Capture Google Geocoding responses
  console.log("\n🗺️  Capturing Google Geocoding responses...");

  const validAddress = await geocodeAddress("бул. Витоша 1, София");
  writeFixture("google-geocoding/valid-address-sofia.json", validAddress);
  console.log("  ✓ Valid Sofia address");

  const centerFallback = await geocodeAddress("София, България");
  writeFixture("google-geocoding/sofia-center-fallback.json", centerFallback);
  console.log("  ✓ Sofia center fallback");

  const outsideSofia = await geocodeAddress("Пловдив, България");
  writeFixture("google-geocoding/outside-sofia.json", outsideSofia);
  console.log("  ✓ Address outside Sofia");

  const invalidAddress = await geocodeAddress("Invalid Street 999, Sofia");
  writeFixture("google-geocoding/invalid-address.json", invalidAddress);
  console.log("  ✓ Invalid address");

  // Capture Overpass API responses
  console.log("\n🛣️  Capturing Overpass API responses...");

  const streetGeometry = await overpassGeocodeAddresses(["булевард Витоша"]);
  writeFixture("overpass/street-geometry-vitosha.json", streetGeometry);
  console.log("  ✓ Street geometry (Vitosha)");

  const intersection = await overpassGeocodeAddresses([
    "булевард Мария Луиза ∩ улица Екзарх Йосиф",
  ]);
  writeFixture("overpass/intersection-result.json", intersection);
  console.log("  ✓ Street intersection");

  // Capture Cadastre API responses
  console.log("\n🏘️  Capturing Cadastre API responses...");

  try {
    const cadastreResult = await geocodeCadastralProperty("68134.501.123");
    writeFixture("cadastre/property-geometry.json", cadastreResult);
    console.log("  ✓ Cadastral property geometry");
  } catch {
    console.log(
      "  ⚠️  Cadastre API call failed (this is expected if session expired)",
    );
    console.log("     You may need to capture this fixture manually");
    writeFixture("cadastre/property-geometry.json", null);
  }

  console.log("\n✅ API response capture complete!");
  console.log(`📁 Fixtures saved to: ${fixtureBase}`);
  console.log("\n💡 Next steps:");
  console.log("   1. Review generated fixtures for accuracy");
  console.log("   2. Add more test cases if needed");
  console.log("   3. Enable mock mode: MOCK_*_API=true in .env.local");
}

function writeFixture(path: string, data: any) {
  const fixtureBase = resolve(__dirname, "../__mocks__/fixtures");
  const fullPath = resolve(fixtureBase, path);
  writeFileSync(fullPath, JSON.stringify(data, null, 2), "utf-8");
}

captureApiResponses().catch((error) => {
  console.error("❌ Error capturing API responses:", error);
  process.exit(1);
});
