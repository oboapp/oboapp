// Official Bulgarian transliteration (Streamlined System, 2009)
const CYRILLIC_TO_LATIN: Record<string, string> = {
  А: "A", Б: "B", В: "V", Г: "G", Д: "D", Е: "E", Ж: "Zh", З: "Z",
  И: "I", Й: "Y", К: "K", Л: "L", М: "M", Н: "N", О: "O", П: "P",
  Р: "R", С: "S", Т: "T", У: "U", Ф: "F", Х: "H", Ц: "Ts", Ч: "Ch",
  Ш: "Sh", Щ: "Sht", Ъ: "A", Ь: "Y", Ю: "Yu", Я: "Ya",
};

export function transliterate(cyrillic: string): string {
  return cyrillic
    .split("")
    .map((char) => {
      const upper = char.toUpperCase();
      const mapped = CYRILLIC_TO_LATIN[upper];
      if (!mapped) return char;
      return char === upper ? mapped.toUpperCase() : mapped.toLowerCase();
    })
    .join("");
}
