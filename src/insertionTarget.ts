import type { TFile } from "obsidian";

export type InsertionTarget =
    | { kind: "clipboard" }
    | { kind: "transcript-file" }
    | { kind: "editor-anchor"; file: TFile; marker: string };
