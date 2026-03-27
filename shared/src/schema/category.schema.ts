import { z } from "../zod-openapi";

export const CategoryEnum = z.enum([
  "air-quality",
  "art",
  "bicycles",
  "construction-and-repairs",
  "culture",
  "education",
  "electricity",
  "health",
  "heating",
  "parking",
  "public-transport",
  "road-block",
  "sports",
  "traffic",
  "vehicles",
  "waste",
  "water",
  "weather",
]);

export type Category = z.infer<typeof CategoryEnum>;

// Array of category values for iteration
export const CATEGORIES = CategoryEnum.options;

// Special frontend-only identifier for messages without categories
// This is NOT a real category - just a UI filtering concept
export const UNCATEGORIZED = "uncategorized" as const;

// Bulgarian translations for real categories
export const CATEGORY_LABELS: Record<Category, string> = {
  "air-quality": "Качество на въздуха",
  art: "Изкуство",
  bicycles: "Велосипеди",
  "construction-and-repairs": "Строителство и ремонти",
  culture: "Култура",
  education: "Образование",
  electricity: "Електричество",
  health: "Здравеопазване",
  heating: "Отопление",
  parking: "Паркиране",
  "public-transport": "Градски транспорт",
  "road-block": "Блокиран път",
  sports: "Спорт",
  traffic: "Трафик",
  vehicles: "Превозни средства",
  waste: "Отпадъци",
  water: "Вода",
  weather: "Време",
};

// Separate label for the uncategorized UI option
export const UNCATEGORIZED_LABEL = "Некатегоризирани";

// Display order for real categories (most common first)
export const CATEGORY_DISPLAY_ORDER: Category[] = [
  "water",
  "electricity",
  "heating",
  "traffic",
  "construction-and-repairs",
  "road-block",
  "public-transport",
  "parking",
  "waste",
  "weather",
  "air-quality",
  "vehicles",
  "health",
  "education",
  "culture",
  "art",
  "sports",
  "bicycles",
];
// Note: UNCATEGORIZED will be appended in the UI logic, not here
