import { _ExportPlugin } from "./export_plugin";

@tool
export class _Plugin extends EditorPlugin {
  _export_plugin = new _ExportPlugin();

  _enter_tree(): void {
    this.add_export_plugin(this._export_plugin);
  }

  _exit_tree(): void {
    this.remove_export_plugin(this._export_plugin);
  }
}
