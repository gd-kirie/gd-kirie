import { _ExportPlugin } from "./export_plugin";

@tool
export class _Plugin extends EditorPlugin {
  _export_plugin: EditorExportPlugin | null = null;

  _enter_tree(): void {
    const export_plugin = new _ExportPlugin();
    this._export_plugin = export_plugin;
    this.add_export_plugin(export_plugin);
  }

  _exit_tree(): void {
    if (this._export_plugin === null) {
      return;
    }

    this.remove_export_plugin(this._export_plugin);
    this._export_plugin = null;
  }
}
