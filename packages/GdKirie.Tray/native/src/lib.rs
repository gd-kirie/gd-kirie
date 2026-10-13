// See docs/decisions/0014-load-tray-through-a-gdextension.md.
use std::panic::{AssertUnwindSafe, catch_unwind};

use godot::prelude::*;
use serde::Deserialize;
use tray_icon::{
    Icon, TrayIcon, TrayIconBuilder,
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
};

struct KirieTrayExtension;

#[gdextension]
unsafe impl ExtensionLibrary for KirieTrayExtension {}

#[derive(GodotClass)]
#[class(init, base=RefCounted)]
struct KirieTrayNative {
    tray: Option<TrayIcon>,
}

#[godot_api]
impl KirieTrayNative {
    #[func]
    fn create(
        &mut self,
        rgba: PackedByteArray,
        width: i64,
        height: i64,
        icon_as_template: bool,
    ) -> GString {
        operation_error(|| {
            let icon = read_icon(rgba.to_vec(), width, height)?;
            let builder = TrayIconBuilder::new();

            #[cfg(target_os = "macos")]
            let builder = if icon_as_template {
                builder.with_icon_templated(icon)
            } else {
                builder.with_icon(icon)
            };

            #[cfg(not(target_os = "macos"))]
            let builder = {
                if icon_as_template {
                    return Err("template tray icons are supported only on macOS".into());
                }

                builder.with_icon(icon)
            };

            let tray = builder.build().map_err(|error| error.to_string())?;
            // A page reload replaces the icon while the Eventa host stays attached.
            self.tray = Some(tray);
            Ok(())
        })
    }

    #[func]
    fn set_icon(
        &self,
        rgba: PackedByteArray,
        width: i64,
        height: i64,
        icon_as_template: bool,
    ) -> GString {
        operation_error(|| {
            let icon = read_icon(rgba.to_vec(), width, height)?;
            let tray = self.tray()?;

            #[cfg(target_os = "macos")]
            let result = if icon_as_template {
                tray.set_icon_templated(Some(icon))
            } else {
                tray.set_icon(Some(icon))
            };

            #[cfg(not(target_os = "macos"))]
            let result = {
                if icon_as_template {
                    return Err("template tray icons are supported only on macOS".into());
                }

                tray.set_icon(Some(icon))
            };

            result.map_err(|error| error.to_string())
        })
    }

    #[func]
    fn set_menu(&self, json: GString) -> GString {
        operation_error(|| {
            let definitions: Vec<MenuDefinition> =
                serde_json::from_str(&json.to_string()).map_err(|error| error.to_string())?;
            let menu = build_menu(&definitions)?;
            self.tray()?.set_menu(Some(Box::new(menu)));
            Ok(())
        })
    }

    #[func]
    fn set_tooltip(&self, tooltip: GString) -> GString {
        let tooltip = tooltip.to_string();
        operation_error(|| {
            let tooltip = (!tooltip.is_empty()).then_some(tooltip.as_str());
            self.tray()?
                .set_tooltip(tooltip)
                .map_err(|error| error.to_string())
        })
    }

    #[func]
    fn set_visible(&self, visible: bool) -> GString {
        operation_error(|| {
            self.tray()?
                .set_visible(visible)
                .map_err(|error| error.to_string())
        })
    }

    #[func]
    fn poll_menu_events(&self) -> PackedStringArray {
        let mut events = PackedStringArray::new();
        while let Ok(event) = MenuEvent::receiver().try_recv() {
            events.push(&GString::from(&event.id.0));
        }

        events
    }

    #[func]
    fn destroy(&mut self) -> GString {
        operation_error(|| {
            drop(self.tray.take());
            Ok(())
        })
    }

    fn tray(&self) -> Result<&TrayIcon, String> {
        self.tray
            .as_ref()
            .ok_or_else(|| "the tray icon does not exist".to_string())
    }
}

// Godot's panic fallback returns an empty string, which this boundary reserves for success.
fn operation_error(operation: impl FnOnce() -> Result<(), String>) -> GString {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(Ok(())) => GString::new(),
        Ok(Err(error)) => error.as_str().into(),
        Err(payload) => {
            let message = payload
                .downcast_ref::<&str>()
                .copied()
                .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
                .unwrap_or("unknown panic");

            format!("native tray panic: {message}").as_str().into()
        }
    }
}

fn read_icon(rgba: Vec<u8>, width: i64, height: i64) -> Result<Icon, String> {
    let width =
        u32::try_from(width).map_err(|_| "tray icon width is outside the supported range")?;
    let height =
        u32::try_from(height).map_err(|_| "tray icon height is outside the supported range")?;

    Icon::from_rgba(rgba, width, height).map_err(|error| error.to_string())
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum MenuDefinition {
    Item {
        id: String,
        text: String,
        #[serde(default = "default_enabled")]
        enabled: bool,
    },
    Check {
        id: String,
        text: String,
        #[serde(default = "default_enabled")]
        enabled: bool,
        #[serde(default)]
        checked: bool,
    },
    Submenu {
        text: String,
        #[serde(default = "default_enabled")]
        enabled: bool,
        children: Vec<MenuDefinition>,
    },
    Separator,
}

const fn default_enabled() -> bool {
    true
}

fn build_menu(definitions: &[MenuDefinition]) -> Result<Menu, String> {
    let menu = Menu::new();
    for definition in definitions {
        let item = build_menu_item(definition)?;
        menu.append(item.as_ref())
            .map_err(|error| error.to_string())?;
    }

    Ok(menu)
}

fn build_menu_item(definition: &MenuDefinition) -> Result<Box<dyn IsMenuItem>, String> {
    match definition {
        MenuDefinition::Item { id, text, enabled } => {
            Ok(Box::new(MenuItem::with_id(id, text, *enabled, None)))
        }
        MenuDefinition::Check {
            id,
            text,
            enabled,
            checked,
        } => Ok(Box::new(CheckMenuItem::with_id(
            id, text, *enabled, *checked, None,
        ))),
        MenuDefinition::Submenu {
            text,
            enabled,
            children,
        } => {
            let submenu = Submenu::new(text, *enabled);
            for child in children {
                let item = build_menu_item(child)?;
                submenu
                    .append(item.as_ref())
                    .map_err(|error| error.to_string())?;
            }

            Ok(Box::new(submenu))
        }
        MenuDefinition::Separator => Ok(Box::new(PredefinedMenuItem::separator())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_icon_dimensions_and_pixels() {
        assert!(read_icon(vec![0; 4], -1, 1).is_err());
        assert!(read_icon(vec![0; 4], 1, i64::MAX).is_err());
        assert!(read_icon(vec![0; 3], 1, 1).is_err());
    }

    #[test]
    fn parses_supported_menu_tree() {
        let menu = serde_json::from_str::<Vec<MenuDefinition>>(
            r#"[
                {"type":"item","id":"open","text":"Open"},
                {"type":"check","id":"enabled","text":"Enabled","checked":true},
                {"type":"separator"},
                {"type":"submenu","text":"More","children":[
                    {"type":"item","id":"quit","text":"Quit","enabled":false}
                ]}
            ]"#,
        )
        .expect("valid menu should parse");

        assert_eq!(menu.len(), 4);
        assert!(matches!(
            &menu[0],
            MenuDefinition::Item {
                id,
                text,
                enabled: true
            } if id == "open" && text == "Open"
        ));
        assert!(matches!(
            &menu[1],
            MenuDefinition::Check {
                id,
                text,
                enabled: true,
                checked: true
            } if id == "enabled" && text == "Enabled"
        ));
        assert!(matches!(menu[2], MenuDefinition::Separator));
        assert!(matches!(
            &menu[3],
            MenuDefinition::Submenu {
                text,
                enabled: true,
                children
            } if text == "More" && children.len() == 1
        ));
    }
}
