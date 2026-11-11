import fs from "node:fs";
import path from "node:path";
import { parse as parseIni } from "ini";

interface ParsedExportPreset {
  name?: string;
  options?: Record<string, unknown>;
  platform?: string;
}

interface ParsedExportPresets {
  preset?: Record<string, ParsedExportPreset>;
}

export interface ExportPresetSummary {
  index: number;
  name: string;
  options: Record<string, unknown>;
  platform: string;
}

export interface ReadExportPresetValueOptions {
  optionName: string;
  presetName: string;
  projectDir: string;
}

export function listExportPresets(projectDir: string): ExportPresetSummary[] {
  const exportPresetsPath = path.join(projectDir, "export_presets.cfg");
  if (!fs.existsSync(exportPresetsPath)) {
    return [];
  }

  const config = parseIni(fs.readFileSync(exportPresetsPath, "utf8")) as ParsedExportPresets;
  const presets: ExportPresetSummary[] = [];

  for (const [key, preset] of Object.entries(config.preset ?? {})) {
    const index = Number(key);
    if (!Number.isInteger(index) || !preset.name || !preset.platform) {
      continue;
    }

    presets.push({
      index,
      name: preset.name,
      options: preset.options ?? {},
      platform: preset.platform,
    });
  }

  return presets.sort((left, right) => left.index - right.index);
}

export function readExportPresetValue(options: ReadExportPresetValueOptions): unknown {
  const exportPresetsPath = path.join(options.projectDir, "export_presets.cfg");
  const config = parseIni(fs.readFileSync(exportPresetsPath, "utf8")) as ParsedExportPresets;

  for (const preset of Object.values(config.preset ?? {})) {
    if (preset.name !== options.presetName) {
      continue;
    }

    const value = preset.options?.[options.optionName];
    if (value === undefined) {
      throw new Error(
        `Export preset option not found: ${options.optionName} in ${exportPresetsPath}`,
      );
    }

    return value;
  }

  throw new Error(`Export preset not found: ${options.presetName} in ${exportPresetsPath}`);
}
