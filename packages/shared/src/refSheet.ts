/* Cast references → a reference sheet and the prose that explains it.
 *
 * LTX doesn't take "here are my characters" as a list. The Ingredients IC-LoRA
 * takes ONE picture — a sheet whose cells hold each subject, prop and setting —
 * and a prompt that says what sits in each cell. Get the two out of step and the
 * model reads a prop as a character.
 *
 * So the layout lives here, in one pure place, and everything downstream agrees
 * with it: the ffmpeg compositor draws the cells in this order, this module
 * writes the description block naming them, and the Video lab shows the user the
 * same labels. Vocabulary ("Top Row Left", "**Middle Row Right (Prop - …):**")
 * is copied from the IC-LoRA's own example prompt rather than invented — it's
 * what the weights were trained to read.
 *
 * Pure and dependency-free: no filesystem, no ComfyUI, no image work. */

import type { BibleCharacter, BibleLocation, DirectorRef } from "./index.js";

/** Three rows of two — the shape the Ingredients examples use, and the ceiling
 * on directorSpecSchema.refs. */
export const SHEET_COLS = 2;
export const MAX_SHEET_REFS = 6;

export interface SheetCell {
  /** index into refs[], and the order the compositor draws cells in */
  index: number;
  row: number;
  col: number;
  /** "Top Row Left" — how the prompt addresses this cell */
  label: string;
}

export interface SheetLayout {
  cols: number;
  rows: number;
  cells: SheetCell[];
}

/** Where each ref lands. One ref needs no grid at all — it fills the sheet and
 * is addressed as "Reference", which keeps a single-subject shot from carrying
 * a spatial description of a layout that isn't there. */
export function sheetLayout(count: number): SheetLayout {
  const n = Math.max(0, Math.min(MAX_SHEET_REFS, Math.floor(count)));
  const cols = n <= 1 ? 1 : SHEET_COLS;
  const rows = Math.max(1, Math.ceil(n / cols));
  const cells: SheetCell[] = [];
  for (let index = 0; index < n; index += 1) {
    const row = Math.floor(index / cols);
    const col = index % cols;
    cells.push({ index, row, col, label: cellLabel(row, col, rows, cols) });
  }
  return { cols, rows, cells };
}

function cellLabel(row: number, col: number, rows: number, cols: number): string {
  if (rows === 1 && cols === 1) return "Reference";
  const rowName =
    rows === 1
      ? "Top Row"
      : row === 0
        ? "Top Row"
        : row === rows - 1
          ? "Bottom Row"
          : rows === 3
            ? "Middle Row"
            : `Row ${row + 1}`;
  const colName = cols === 1 ? "" : col === 0 ? "Left" : "Right";
  return colName ? `${rowName} ${colName}` : rowName;
}

const KIND_WORD: Record<DirectorRef["kind"], string> = {
  character: "Character",
  prop: "Prop",
  setting: "Setting",
};

/** "Character - Sterling", or just "Character" for an unnamed ref */
export function refRole(ref: DirectorRef): string {
  const name = ref.name.trim();
  return name ? `${KIND_WORD[ref.kind]} - ${name}` : KIND_WORD[ref.kind];
}

/** A cast member as a sheet cell. The bible already holds what has to stay true
 * about a character across shots — species, wardrobe, the identity anchors the
 * character sheets were built around — so a ref filled from the bible says the
 * same things a storyboard keyframe would, and nobody retypes them. */
export function castRef(character: BibleCharacter, image: string): DirectorRef {
  const bits = [
    character.species && `a ${character.species}`,
    character.build,
    character.face,
    character.wardrobe && `wearing ${character.wardrobe}`,
    character.colors,
    character.signatureFeature,
    character.anchors.face || character.anchors.body,
  ]
    .map((s) => (s ?? "").trim())
    .filter(Boolean);
  return {
    image,
    name: character.name,
    kind: "character",
    description: bits.join(", "),
  };
}

/** A location as a sheet cell — the set the shot has to stay inside */
export function settingRef(location: BibleLocation, image: string): DirectorRef {
  return {
    image,
    name: location.name,
    kind: "setting",
    description: (location.description || location.stylePrompt).trim(),
  };
}

/** The shot prompt with the sheet explained in front of it.
 *
 * No refs → the target prompt untouched, so the render path can call this
 * unconditionally. A ref with no prose still gets a line: the model needs to be
 * told the cell is a character even when we can't say what kind of character,
 * and an unmentioned cell is worse than a thin one. */
export function composeSheetPrompt(refs: DirectorRef[], target: string): string {
  const used = refs.slice(0, MAX_SHEET_REFS);
  if (used.length === 0) return target;
  const layout = sheetLayout(used.length);
  const lines = layout.cells.map((cell) => {
    const ref = used[cell.index];
    const prose = ref.description.trim() || ref.name.trim() || KIND_WORD[ref.kind];
    return `**${cell.label} (${refRole(ref)}):** ${prose.replace(/\s+/g, " ")}`;
  });
  return [
    "### Reference Sheet Description",
    ...lines,
    "### Target Description",
    target.trim(),
  ].join("\n");
}
