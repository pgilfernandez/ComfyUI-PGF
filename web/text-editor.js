import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "PGF.TextEditor",
    nodeCreated(node) {
        if (node.comfyClass !== "PGFEditTextFile") return;

        const editor = node.widgets.find((widget) => widget.name === "text");
        let busy = false;

        async function chooseFile(kind) {
            if (busy) return;
            busy = true;
            const text = editor.value;
            try {
                const body = { file: node.properties.file ?? "" };
                if (kind === "save") body.text = text;
                const response = await api.fetchApi(`/pgf/pick-${kind}`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                if (!response.headers.get("content-type")?.includes("application/json")) {
                    throw new Error(`ComfyUI returned HTTP ${response.status}.`);
                }
                const result = await response.json();
                if (!response.ok) throw new Error(result.error ?? response.statusText);
                if (result.file === null || !node.graph) return;

                if (kind === "read") {
                    if (editor.value !== text) throw new Error("The editor changed while the file was opening.");
                    editor.value = result.text;
                    editor.callback?.(result.text, app.canvas, node);
                }
                node.properties.file = result.file;
                node.setDirtyCanvas(true, true);
                app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.captureCanvasState?.();
                if (kind === "save") {
                    app.extensionManager.toast.add({ severity: "success", summary: "Text saved", detail: result.file });
                }
            } catch (error) {
                app.extensionManager.toast.add({
                    severity: "error",
                    summary: kind === "save" ? "Could not save text" : "Could not open text",
                    detail: error.message,
                });
            } finally {
                busy = false;
            }
        }

        const open = node.addWidget("button", "Open .txt", null, () => chooseFile("read"), { serialize: false });
        const save = node.addWidget("button", "Save .txt", null, () => chooseFile("save"), { serialize: false });
        open.serialize = false;
        save.serialize = false;
    },
});
