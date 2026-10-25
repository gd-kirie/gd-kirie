type PointerPhase = "down" | "move" | "up" | "cancel";
type PointerType = "mouse" | "pen" | "touch";

interface ActivePointer {
  pointer_type: PointerType;
  button: int;
  position: Vector2;
}

export class _PointerInputForwarder extends RefCounted {
  // Replays pointer control records from a Kirie WebView as Godot InputEvents.
  // ASCII "KIRI". A stable non-hardware ID lets consumers distinguish forwarded
  // events from physical input instead of reporting them as Godot's default device 0.
  // InputEvent.device:
  // https://docs.godotengine.org/en/stable/classes/class_inputevent.html
  _last_positions: Dictionary<int, Vector2> = {};
  _active_pointers: Dictionary<int, ActivePointer> = {};

  reset(cef_control: Control | null = null): void {
    const active_pointers = this._active_pointers.duplicate(true);
    this._last_positions.clear();
    this._active_pointers.clear();
    for (const pointer_id of active_pointers.keys()) {
      const state = active_pointers.get(pointer_id);
      const position = state.position;
      let event: InputEvent;
      if (state.pointer_type === "mouse") {
        const button_index = this._mouse_button_index(state.button);
        if (button_index === MouseButton.MOUSE_BUTTON_NONE) {
          continue;
        }

        const button = new InputEventMouseButton();
        button.device = _PointerInputForwarder.FORWARDED_POINTER_DEVICE_ID;
        button.position = position;
        button.set("global_position", position);
        button.button_index = button_index;
        button.pressed = false;
        button.canceled = true;
        event = button;
      } else {
        const touch = new InputEventScreenTouch();
        touch.device = _PointerInputForwarder.FORWARDED_POINTER_DEVICE_ID;
        touch.index = pointer_id;
        touch.position = position;
        touch.pressed = false;
        touch.canceled = true;
        event = touch;
      }

      this._set_event_window(event, cef_control);
      this._dispatch_event(event, cef_control);
    }
  }

  try_forward_pointer_input(
    value: unknown,
    enabled: boolean,
    cef_control: Control | null = null,
  ): boolean {
    if (!(value instanceof Dictionary)) {
      return false;
    }

    if (!value.has(_PointerInputForwarder.PACKET_KEY)) {
      return false;
    }

    const input_candidate = value.get(_PointerInputForwarder.PACKET_KEY);
    if (!(input_candidate instanceof Dictionary)) {
      push_warning("Ignored malformed Kirie input control record");
      return true;
    }

    if (`${input_candidate.get("kind", "")}` !== "pointer") {
      push_warning("Ignored unsupported Kirie input control record");
      return true;
    }

    if (!enabled) {
      return true;
    }

    const event = this._create_event(input_candidate, cef_control);
    if (event === null) {
      return true;
    }

    this._dispatch_event(event, cef_control);
    return true;
  }

  _create_event(input: Dictionary, cef_control: Control | null): InputEvent | null {
    const normalized_x = input.get("normalized_x", NAN);
    const normalized_y = input.get("normalized_y", NAN);
    const pointer_id_value = input.get("pointer_id", 0);
    const button_value = input.get("button", -1);
    const buttons_value = input.get("buttons", 0);
    const pointer_type = `${input.get("pointer_type", "")}`;
    const pressure_value = input.get("pressure", pointer_type === "mouse"
      ? 0.0
      : 1.0);
    if (
      !this._is_number(normalized_x) ||
      !this._is_number(normalized_y) ||
      !this._is_number(pointer_id_value) ||
      !this._is_number(button_value) ||
      !this._is_number(buttons_value) ||
      !this._is_number(pressure_value)
    ) {
      push_warning("Ignored Kirie input packet with invalid numeric fields");
      return null;
    }

    let normalized_position = Vector2(float(normalized_x), float(normalized_y));
    if (!is_finite(normalized_position.x) || !is_finite(normalized_position.y)) {
      push_warning("Ignored Kirie input packet with invalid coordinates");
      return null;
    }

    normalized_position = normalized_position.clamp(Vector2.ZERO, Vector2.ONE);
    const position = this._resolve_window_position(normalized_position, cef_control);
    const pointer_id = int(pointer_id_value);
    const phase = `${input.get("phase", "")}`;
    if (phase !== "down" && phase !== "move" && phase !== "up" && phase !== "cancel") {
      push_warning(`Ignored Kirie input packet with unknown phase: ${phase}`);
      return null;
    }

    const previous_position = this._last_positions.get(pointer_id, position);
    let event: InputEvent | null;
    if (pointer_type === "touch" || pointer_type === "pen") {
      event = this._create_touch_event(phase, pointer_id, position, previous_position, pressure_value);
    } else if (pointer_type === "mouse") {
      event = this._create_mouse_event(
        phase,
        pointer_id,
        position,
        previous_position,
        int(button_value),
        int(buttons_value),
        pressure_value,
      );
    } else {
      push_warning(`Ignored Kirie input packet with unknown pointer type: ${pointer_type}`);
      return null;
    }

    if (event === null) {
      return null;
    }

    if (phase === "down" || phase === "move") {
      this._last_positions[pointer_id] = position;
    } else {
      this._last_positions.erase(pointer_id);
    }

    if (phase === "down") {
      this._active_pointers.set(pointer_id, {
        pointer_type: pointer_type,
        button: int(button_value),
        position: position,
      });
    } else if (phase === "move" && this._active_pointers.has(pointer_id)) {
      const state = this._active_pointers.get(pointer_id);
      state.position = position;
    } else if (phase === "up" || phase === "cancel") {
      this._active_pointers.erase(pointer_id);
    }

    this._set_event_window(event, cef_control);
    return event;
  }

  _create_touch_event(
    phase: PointerPhase,
    pointer_id: int,
    position: Vector2,
    previous_position: Vector2,
    pressure: number,
  ): InputEvent {
    if (phase === "move") {
      const drag = new InputEventScreenDrag();
      drag.device = _PointerInputForwarder.FORWARDED_POINTER_DEVICE_ID;
      drag.index = pointer_id;
      drag.position = position;
      drag.relative = gd.ops.sub(position, previous_position);
      drag.screen_relative = drag.relative;
      drag.pressure = clampf(float(pressure), 0.0, 1.0);
      return drag;
    }

    const touch = new InputEventScreenTouch();
    touch.device = _PointerInputForwarder.FORWARDED_POINTER_DEVICE_ID;
    touch.index = pointer_id;
    touch.position = position;
    touch.pressed = phase === "down";
    touch.canceled = phase === "cancel";
    return touch;
  }

  _create_mouse_event(
    phase: PointerPhase,
    pointer_id: int,
    position: Vector2,
    previous_position: Vector2,
    dom_button: int,
    dom_buttons: int,
    pressure: number,
  ): InputEvent | null {
    if (phase === "move") {
      const motion = new InputEventMouseMotion();
      motion.device = _PointerInputForwarder.FORWARDED_POINTER_DEVICE_ID;
      motion.position = position;
      motion.set("global_position", position);
      motion.relative = gd.ops.sub(position, previous_position);
      motion.screen_relative = motion.relative;
      motion.button_mask = this._mouse_button_mask(dom_buttons);
      motion.pressure = clampf(float(pressure), 0.0, 1.0);
      return motion;
    }

    let button_index = this._mouse_button_index(dom_button);
    if (button_index === MouseButton.MOUSE_BUTTON_NONE && phase === "cancel") {
      if (this._active_pointers.has(pointer_id)) {
        const state = this._active_pointers.get(pointer_id);
        button_index = this._mouse_button_index(state.button);
      }
    }

    if (button_index === MouseButton.MOUSE_BUTTON_NONE) {
      push_warning("Ignored Kirie input packet with unknown mouse button");
      return null;
    }

    const button = new InputEventMouseButton();
    button.device = _PointerInputForwarder.FORWARDED_POINTER_DEVICE_ID;
    button.position = position;
    button.set("global_position", position);
    button.button_index = button_index;
    button.button_mask = phase === "cancel"
      ? 0
      : this._mouse_button_mask(dom_buttons);
    button.pressed = phase === "down";
    button.canceled = phase === "cancel";
    return button;
  }

  _resolve_window_position(normalized_position: Vector2, cef_control: Control | null): Vector2 {
    if (cef_control === null) {
      return gd.ops.mul(normalized_position, Vector2(DisplayServer.window_get_size()));
    }

    const local_position = gd.ops.mul(normalized_position, cef_control.size);
    const viewport_position = gd.ops.mul(
      cef_control.get_global_transform_with_canvas(),
      local_position,
    );
    return gd.ops.mul(cef_control.get_viewport().get_final_transform(), viewport_position);
  }

  _dispatch_event(event: InputEvent, cef_control: Control | null): void {
    if (cef_control === null) {
      Input.parse_input_event(event);
      return;
    }

    // parse_input_event() injects the forwarded event into Godot's normal input
    // pipeline. Godot CEF receives that pipeline in CefTexture.input() and sends
    // pointer events back to CEF. If its Control remains active, the event loops
    // WebView -> Godot -> WebView. Temporarily disable _input() to break the loop
    // and use MOUSE_FILTER_IGNORE so Godot Controls behind CEF receive the event.
    // Flush synchronously before restoring both settings.
    // Godot API:
    // https://docs.godotengine.org/en/stable/classes/class_input.html
    // Godot CEF: CefTexture.input() and handle_input_event().
    // https://github.com/dsh0416/godot-cef/blob/main/crates/gdcef/src/cef_texture/mod.rs
    const was_processing_input = cef_control.is_processing_input();
    const previous_mouse_filter = cef_control.mouse_filter;
    cef_control.set_process_input(false);
    cef_control.mouse_filter = Control.MOUSE_FILTER_IGNORE;
    Input.parse_input_event(event);
    Input.flush_buffered_events();
    cef_control.mouse_filter = previous_mouse_filter;
    cef_control.set_process_input(was_processing_input);
  }

  _set_event_window(event: InputEvent, cef_control: Control | null): void {
    if (cef_control === null) {
      return;
    }

    if (!(event instanceof InputEventFromWindow)) {
      return;
    }

    const window = cef_control.get_window();
    if (window === null) {
      return;
    }

    event.window_id = window.get_window_id();
  }

  _mouse_button_mask(dom_buttons: int): MouseButtonMask {
    let mask: int = 0;
    if ((dom_buttons & 1) !== 0) {
      mask = mask | MouseButtonMask.MOUSE_BUTTON_MASK_LEFT;
    }

    if ((dom_buttons & 2) !== 0) {
      mask = mask | MouseButtonMask.MOUSE_BUTTON_MASK_RIGHT;
    }

    if ((dom_buttons & 4) !== 0) {
      mask = mask | MouseButtonMask.MOUSE_BUTTON_MASK_MIDDLE;
    }

    if ((dom_buttons & 8) !== 0) {
      mask = mask | MouseButtonMask.MOUSE_BUTTON_MASK_MB_XBUTTON1;
    }

    if ((dom_buttons & 16) !== 0) {
      mask = mask | MouseButtonMask.MOUSE_BUTTON_MASK_MB_XBUTTON2;
    }

    return mask as MouseButtonMask;
  }

  _is_number(value: unknown): value is number {
    return gd.is(value, int) || gd.is(value, float);
  }

  _mouse_button_index(dom_button: int): MouseButton {
    switch (dom_button) {
      case 0:
        return MouseButton.MOUSE_BUTTON_LEFT;
      case 1:
        return MouseButton.MOUSE_BUTTON_MIDDLE;
      case 2:
        return MouseButton.MOUSE_BUTTON_RIGHT;
      case 3:
        return MouseButton.MOUSE_BUTTON_XBUTTON1;
      case 4:
        return MouseButton.MOUSE_BUTTON_XBUTTON2;
      default:
        return MouseButton.MOUSE_BUTTON_NONE;
    }
  }
}

export namespace _PointerInputForwarder {
  export const PACKET_KEY = "__gd_kirie_control";
  export const FORWARDED_POINTER_DEVICE_ID = 0x4B495249;
}
