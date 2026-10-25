/*
 * Minimal DOM adapter for Godot Web.
 * Keep data rules and application protocols out of this file.
 */
(() => {
  const protocol = "gd-kirie/iframe-port/1";
  const lanes = new Set(["text", "binary", "data"]);

  function resolveUrl(url) {
    if (url.startsWith("res://")) {
      const webRoot = "res://src-web/dist";
      if (url !== webRoot && !url.startsWith(`${webRoot}/`) && !url.startsWith(`${webRoot}?`)) {
        throw new Error(`Kirie Web can only map ${webRoot} resource URLs.`);
      }

      const resourcePath = url === webRoot || url.startsWith(`${webRoot}?`)
        ? `src-web/dist/index.html${url.slice(webRoot.length)}`
        : url.slice("res://".length);
      const mappedRoot = new URL("src-web/dist/", location.href);
      const mapped = new URL(resourcePath, location.href);
      if (!mapped.href.startsWith(mappedRoot.href)) {
        throw new Error(`Kirie Web resource URL escapes ${webRoot}: ${url}`);
      }

      return mapped.href;
    }

    const resolved = new URL(url || "about:blank", location.href);
    if (resolved.href !== "about:blank" &&
      (!["http:", "https:"].includes(resolved.protocol) || resolved.origin !== location.origin)) {
      throw new Error("Kirie Web requires a same-origin HTTP URL.");
    }

    return resolved.href;
  }

  globalThis.__kirieIframeHost = {
    launch_option: (key) => new URL(location.href).searchParams.get(key) ?? "",
    create(callback, url, visible = true, html = null, baseUrl = "") {
      const canvas = document.getElementById("canvas");
      let frame = null;
      let port = null;
      let tick = 0;
      let ready = false;

      const report = (error) => callback?.("error", String(error));
      const onPortMessage = (event) => {
        const message = event.data;
        if (!message || typeof message.type !== "string") {
          return;
        }

        if (message.type === "ready") {
          if (!ready) {
            ready = true;
            callback?.("ready", null);
          }
          return;
        }

        if (ready && message.type === "message" && lanes.has(message.lane)) {
          callback?.(message.lane, message.payload);
        }
      };
      const onLoad = () => {
        port?.close();
        ready = false;
        const channel = new MessageChannel();
        port = channel.port1;
        port.addEventListener("message", onPortMessage);
        port.addEventListener(
          "messageerror",
          () => report("Kirie iframe message could not be cloned."),
          { once: true },
        );
        port.start();
        frame.contentWindow.postMessage({ protocol }, location.origin, [channel.port2]);
      };
      const layout = () => {
        if (!frame) {
          return;
        }

        const rect = canvas.getBoundingClientRect();
        const style = getComputedStyle(canvas);
        Object.assign(frame.style, {
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          visibility: visible ? style.visibility : "hidden",
          display: visible && style.display !== "none"
            ? "block"
            : "none",
        });
        tick = requestAnimationFrame(layout);
      };
      const removeFrame = () => {
        cancelAnimationFrame(tick);
        port?.close();
        port = null;
        frame?.removeEventListener("load", onLoad);
        frame?.remove();
        frame = null;
        ready = false;
      };
      const navigate = (nextUrl, nextHtml = null, nextBaseUrl = "") => {
        try {
          const resolved = resolveUrl(nextUrl);
          if (!canvas) {
            throw new Error("Kirie Web requires the Godot canvas with id=canvas.");
          }

          const base = nextBaseUrl
            ? resolveUrl(nextBaseUrl)
            : "";
          removeFrame();
          frame = document.createElement("iframe");
          frame.title = "Kirie WebView";
          Object.assign(frame.style, {
            position: "fixed",
            border: "0",
            margin: "0",
            padding: "0",
            zIndex: "1",
          });
          frame.addEventListener("load", onLoad);
          if (nextHtml !== null) {
            const doc = new DOMParser().parseFromString(nextHtml, "text/html");
            if (base) {
              const element = doc.createElement("base");
              element.href = base;
              doc.head.prepend(element);
            }
            frame.srcdoc = `<!doctype html>${doc.documentElement.outerHTML}`;
          } else {
            frame.src = resolved;
          }
          document.body.append(frame);
          layout();
        } catch (error) {
          report(error);
        }
      };

      navigate(url, html, baseUrl);
      return {
        set_visible(value) {
          visible = value;
          if (!visible && document.activeElement === frame) {
            frame.blur();
          }
          cancelAnimationFrame(tick);
          layout();
        },
        load_url: (nextUrl) => navigate(nextUrl),
        load_html: (nextHtml, nextBaseUrl) => navigate("", nextHtml, nextBaseUrl),
        send(lane, payload) {
          if (!port || !ready) {
            report("Kirie iframe bridge is not ready.");
            return;
          }
          if (!lanes.has(lane)) {
            report("Unsupported Kirie iframe lane.");
            return;
          }
          if (lane === "binary" && ArrayBuffer.isView(payload)) {
            payload = payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
          }

          port.postMessage({ type: "message", lane, payload });
        },
        destroy() {
          removeFrame();
          callback = null;
        },
      };
    },
  };
})();
