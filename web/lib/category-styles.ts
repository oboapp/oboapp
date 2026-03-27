/**
 * Category icon and color configuration
 * Maps categories to their visual representation (icon, colors)
 * Based on design specifications
 */

import {
  Droplets,
  Zap,
  Heater,
  Trash2,
  CarFront,
  CircleSlash,
  Bus,
  CircleParking,
  Car,
  Bike,
  CloudRain,
  Wind,
  Heart,
  Drama,
  Palette,
  Trophy,
  Construction,
  GraduationCap,
  CircleHelp,
  type LucideIcon,
} from "lucide-react";
import { Category, UNCATEGORIZED } from "@oboapp/shared";

export interface CategoryStyle {
  /** Lucide icon component */
  icon: LucideIcon;
  /** Primary color for icon and text */
  color: string;
  /** Light background color */
  bgColor: string;
}

/**
 * Category style mappings
 * Icon names and colors from design specification
 */
export const CATEGORY_STYLES: Record<
  Category | typeof UNCATEGORIZED,
  CategoryStyle
> = {
  water: {
    icon: Droplets,
    color: "#0284c7", // sky-600
    bgColor: "#e0f2fe", // sky-100
  },
  electricity: {
    icon: Zap,
    color: "#eab308", // yellow-500
    bgColor: "#fef9c3", // yellow-100
  },
  heating: {
    icon: Heater,
    color: "#dc2626", // red-600
    bgColor: "#fee2e2", // red-100
  },
  waste: {
    icon: Trash2,
    color: "#16a34a", // green-600
    bgColor: "#dcfce7", // green-100
  },
  traffic: {
    icon: CarFront,
    color: "#dc2626", // red-600
    bgColor: "#fee2e2", // red-100
  },
  "road-block": {
    icon: CircleSlash,
    color: "#ea580c", // orange-600
    bgColor: "#ffedd5", // orange-100
  },
  "public-transport": {
    icon: Bus,
    color: "#7c3aed", // violet-600
    bgColor: "#ede9fe", // violet-100
  },
  parking: {
    icon: CircleParking,
    color: "#0891b2", // cyan-600
    bgColor: "#cffafe", // cyan-100
  },
  vehicles: {
    icon: Car,
    color: "#4f46e5", // indigo-600
    bgColor: "#e0e7ff", // indigo-100
  },
  bicycles: {
    icon: Bike,
    color: "#059669", // emerald-600
    bgColor: "#d1fae5", // emerald-100
  },
  weather: {
    icon: CloudRain,
    color: "#0284c7", // sky-600
    bgColor: "#e0f2fe", // sky-100
  },
  "air-quality": {
    icon: Wind,
    color: "#65a30d", // lime-600
    bgColor: "#ecfccb", // lime-100
  },
  health: {
    icon: Heart,
    color: "#dc2626", // red-600
    bgColor: "#fee2e2", // red-100
  },
  culture: {
    icon: Drama,
    color: "#c026d3", // fuchsia-600
    bgColor: "#fae8ff", // fuchsia-100
  },
  art: {
    icon: Palette,
    color: "#db2777", // pink-600
    bgColor: "#fce7f3", // pink-100
  },
  sports: {
    icon: Trophy,
    color: "#16a34a", // green-600
    bgColor: "#dcfce7", // green-100
  },
  "construction-and-repairs": {
    icon: Construction,
    color: "#ea580c", // orange-600
    bgColor: "#ffedd5", // orange-100
  },
  education: {
    icon: GraduationCap,
    color: "#0d9488", // teal-600
    bgColor: "#ccfbf1", // teal-100
  },
  // Uncategorized - special UI-only category
  uncategorized: {
    icon: CircleHelp,
    color: "#6b7280", // gray-500
    bgColor: "#f3f4f6", // gray-100
  },
};

/**
 * Get icon component for a category
 */
export function getCategoryIcon(
  category: Category | typeof UNCATEGORIZED,
): LucideIcon {
  return CATEGORY_STYLES[category]?.icon ?? CircleHelp;
}

/**
 * Get primary color for a category
 */
export function getCategoryColor(
  category: Category | typeof UNCATEGORIZED,
): string {
  return CATEGORY_STYLES[category]?.color ?? "#6b7280";
}

/**
 * Get background color for a category
 */
export function getCategoryBgColor(
  category: Category | typeof UNCATEGORIZED,
): string {
  return CATEGORY_STYLES[category]?.bgColor ?? "#f3f4f6";
}
