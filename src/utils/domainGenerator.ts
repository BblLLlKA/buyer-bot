import fs from "fs";
import path from "path";

// Ported from support-bot's utils/generate-domains.js (same wordlist file,
// same two-part + syllable-brand-word + suffix mechanic) — see that project
// for the original. __dirname here is dist/utils (prod) or src/utils (dev);
// both sit one level under the project root, so ../../data resolves the
// same way in either case.
const words = fs
  .readFileSync(path.join(__dirname, "..", "..", "data", "domain-words.txt"), "utf8")
  .split("\n")
  .filter(Boolean);

const SUFFIXES = ["", "", "", "", "ly", "io", "ai", "go", "hub", "labs", "hq", "x", "ify"];
const SYLLABLES = ["vo", "ra", "fi", "xo", "ly", "ta", "ne", "zi", "go", "ka", "lu", "mi", "ro", "ni", "za"];

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function makeBrandWord(): string {
  const length = randomInt(2, 4);
  let word = "";
  for (let i = 0; i < length; i++) word += randomFrom(SYLLABLES);
  return word;
}

function getPart(): string {
  return Math.random() < 0.3 ? makeBrandWord() : randomFrom(words);
}

/** Generates `count` unique domain names in the given zone (e.g. ".com"). */
export function generateDomains(count: number, zone: string): string[] {
  const domains = new Set<string>();
  while (domains.size < count) {
    const first = getPart();
    const second = getPart();
    const suffix = randomFrom(SUFFIXES);
    domains.add(`${first}${second}${suffix}${zone}`.toLowerCase());
  }
  return [...domains];
}
