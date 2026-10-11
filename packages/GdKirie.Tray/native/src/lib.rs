use std::{
    cell::RefCell,
    ffi::{CStr, CString, c_char},
    panic::{AssertUnwindSafe, catch_unwind},
    ptr, slice,
};

use serde::Deserialize;
use tray_icon::{
    Icon, TrayIcon, TrayIconBuilder,
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu},
};

thread_local! {
    static TRAY: RefCell<Option<TrayIcon>> = const { RefCell::new(None) };
    static LAST_ERROR: RefCell<CString> = RefCell::new(CString::default());
    static LAST_MENU_EVENT: RefCell<Option<CString>> = const { RefCell::new(None) };
}

#[derive(Debug, Deserialize)]
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

#[unsafe(no_mangle)]
/// # Safety
///
/// `rgba` must point to `rgba_len` readable bytes for the duration of this call.
pub unsafe extern "C" fn kirie_tray_create(
    rgba: *const u8,
    rgba_len: usize,
    width: u32,
    height: u32,
    icon_as_template: bool,
) -> bool {
    ffi_bool(|| {
        let icon = read_icon(rgba, rgba_len, width, height)?;
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
        // A page reload calls create again while the .NET host keeps running,
        // so an existing Tray is replaced instead of rejected.
        drop(TRAY.with_borrow_mut(|slot| slot.replace(tray)));

        Ok(())
    })
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `rgba` must point to `rgba_len` readable bytes for the duration of this call.
pub unsafe extern "C" fn kirie_tray_set_icon(
    rgba: *const u8,
    rgba_len: usize,
    width: u32,
    height: u32,
    icon_as_template: bool,
) -> bool {
    ffi_bool(|| {
        let icon = read_icon(rgba, rgba_len, width, height)?;
        with_tray(|tray| {
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
    })
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `json` must point to a null-terminated UTF-8 string for the duration of this call.
pub unsafe extern "C" fn kirie_tray_set_menu(json: *const c_char) -> bool {
    ffi_bool(|| {
        let definitions: Vec<MenuDefinition> =
            serde_json::from_str(unsafe { read_string(json, "menu JSON")? })
                .map_err(|error| error.to_string())?;
        let menu = build_menu(&definitions)?;

        with_tray(|tray| {
            tray.set_menu(Some(Box::new(menu)));
            Ok(())
        })
    })
}

#[unsafe(no_mangle)]
/// # Safety
///
/// `tooltip` must point to a null-terminated UTF-8 string for the duration of this call.
pub unsafe extern "C" fn kirie_tray_set_tooltip(tooltip: *const c_char) -> bool {
    ffi_bool(|| {
        let tooltip = unsafe { read_string(tooltip, "tooltip")? };
        with_tray(|tray| {
            let tooltip = (!tooltip.is_empty()).then_some(tooltip);
            tray.set_tooltip(tooltip).map_err(|error| error.to_string())
        })
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn kirie_tray_set_visible(visible: bool) -> bool {
    ffi_bool(|| with_tray(|tray| tray.set_visible(visible).map_err(|error| error.to_string())))
}

#[unsafe(no_mangle)]
pub extern "C" fn kirie_tray_poll_menu_event() -> *const c_char {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let Ok(event) = MenuEvent::receiver().try_recv() else {
            LAST_MENU_EVENT.with_borrow_mut(|slot| *slot = None);
            return Ok(ptr::null());
        };

        let id = CString::new(event.id.0)
            .map_err(|_| "menu event ID contains an interior null byte".to_string())?;
        LAST_MENU_EVENT.with_borrow_mut(|slot| {
            *slot = Some(id);
            Ok(slot.as_ref().expect("event was just stored").as_ptr())
        })
    }));

    match result {
        Ok(Ok(pointer)) => {
            clear_last_error();
            pointer
        }
        Ok(Err(error)) => {
            set_last_error(error);
            ptr::null()
        }
        Err(payload) => {
            set_last_error(panic_message(payload));
            ptr::null()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn kirie_tray_destroy() -> bool {
    ffi_bool(|| {
        drop(TRAY.with_borrow_mut(Option::take));
        LAST_MENU_EVENT.with_borrow_mut(|slot| *slot = None);
        Ok(())
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn kirie_tray_last_error() -> *const c_char {
    match catch_unwind(AssertUnwindSafe(|| {
        LAST_ERROR.with_borrow(|error| error.as_ptr())
    })) {
        Ok(pointer) => pointer,
        Err(_) => ptr::null(),
    }
}

fn read_icon(rgba: *const u8, rgba_len: usize, width: u32, height: u32) -> Result<Icon, String> {
    if rgba.is_null() {
        return Err("tray icon RGBA pointer is null".into());
    }

    let bytes = unsafe { slice::from_raw_parts(rgba, rgba_len) };
    Icon::from_rgba(bytes.to_vec(), width, height).map_err(|error| error.to_string())
}

unsafe fn read_string<'a>(pointer: *const c_char, name: &str) -> Result<&'a str, String> {
    if pointer.is_null() {
        return Err(format!("{name} pointer is null"));
    }

    unsafe { CStr::from_ptr(pointer) }
        .to_str()
        .map_err(|_| format!("{name} is not valid UTF-8"))
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

fn with_tray<T>(operation: impl FnOnce(&TrayIcon) -> Result<T, String>) -> Result<T, String> {
    TRAY.with_borrow(|slot| {
        let tray = slot
            .as_ref()
            .ok_or_else(|| "the tray icon does not exist".to_string())?;
        operation(tray)
    })
}

fn ffi_bool(operation: impl FnOnce() -> Result<(), String>) -> bool {
    match catch_unwind(AssertUnwindSafe(operation)) {
        Ok(Ok(())) => {
            clear_last_error();
            true
        }
        Ok(Err(error)) => {
            set_last_error(error);
            false
        }
        Err(payload) => {
            set_last_error(panic_message(payload));
            false
        }
    }
}

fn clear_last_error() {
    LAST_ERROR.with_borrow_mut(|error| *error = CString::default());
}

fn set_last_error(error: String) {
    let error = error.replace('\0', "�");
    LAST_ERROR.with_borrow_mut(|slot| {
        *slot = CString::new(error).unwrap_or_else(|_| CString::default());
    });
}

fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    let message = payload
        .downcast_ref::<&str>()
        .copied()
        .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
        .unwrap_or("unknown panic");
    format!("native tray panic: {message}")
}

#[cfg(test)]
mod tests {
    use super::*;

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
