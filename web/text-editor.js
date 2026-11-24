import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "PGF.TextEditor",
    nodeCreated(node) {
        if (node.comfyClass !== "PGFEditTextFile") return;

        const getWidget = (name) => node.widgets.find((widget) => widget.name === name);
        const getLink = (name) => node.inputs?.find((input) => input.name === name)?.link ?? null;
        const editor = getWidget("editor");
        const useEditor = getWidget("use_editor");
        const sourceText = getWidget("source_text");
        const fields = ["text", "path", "filename"];
        let resolved = null;
        let busy = false;

        function setHidden(widget, hidden) {
            widget.hidden = hidden;
            widget.options.hidden = hidden;
        }

        function changed() {
            node.setDirtyCanvas(true, true);
            app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.captureCanvasState?.();
        }

        setHidden(useEditor, true);
        useEditor.computeSize = () => [0, -4];
        if (sourceText) {
            setHidden(sourceText, true);
            sourceText.computeSize = () => [0, -4];
        }
        const originalEdit = editor.callback;
        editor.callback = function (...args) {
            useEditor.value = true;
            return originalEdit?.apply(this, args);
        };
        editor.inputEl?.addEventListener("input", () => { useEditor.value = true; });

        async function request(route, body) {
            const response = await api.fetchApi(route, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (!response.headers.get("content-type")?.includes("application/json")) {
                throw new Error(`ComfyUI returned HTTP ${response.status}.`);
            }
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? response.statusText);
            return result;
        }

        async function runAction(action) {
            if (busy) return;
            busy = true;
            try {
                await action();
            } catch (error) {
                app.extensionManager.toast.add({
                    severity: "error", summary: "PGF - Edit Text File", detail: error.message,
                });
            } finally {
                busy = false;
            }
        }

        function resolvedValue(name) {
            const link = getLink(name);
            const value = resolved?.[name];
            if (link === null) return getWidget(name).value;
            if (!value || value.link !== link || typeof value.text !== "string") {
                throw new Error(`Run the workflow to load the connected ${name}.`);
            }
            return value.text;
        }

        const browse = node.addWidget("button", "Browse folder", null, () => runAction(async () => {
            if (getLink("path") !== null) return;
            const path = getWidget("path");
            const result = await request("/pgf/pick-folder", { folder: path.value });
            if (result.folder === null || !node.graph || getLink("path") !== null) return;
            path.value = result.folder;
            path.callback?.(path.value, app.canvas, node);
            changed();
        }), { serialize: false });
        browse.serialize = false;
        const browseSize = browse.computeSize;

        const save = node.addWidget("button", "Save .txt", null, () => runAction(async () => {
            if (getLink("text") !== null) resolvedValue("text");
            const result = await request("/pgf/save-edited-text", {
                path: resolvedValue("path"),
                filename: resolvedValue("filename"),
                text: editor.value,
            });
            app.extensionManager.toast.add({ severity: "success", summary: "Text saved", detail: result.file });
        }), { serialize: false });
        save.serialize = false;

        function updateBrowse() {
            const hidden = getLink("path") !== null;
            if (Boolean(browse.hidden) === hidden) return;
            setHidden(browse, hidden);
            browse.computeSize = hidden ? () => [0, -4] : browseSize;
            node.setDirtyCanvas(true, true);
        }

        const onConnectionsChange = node.onConnectionsChange;
        node.onConnectionsChange = function (...args) {
            const result = onConnectionsChange?.apply(this, args);
            queueMicrotask(updateBrowse);
            return result;
        };
        const onConfigure = node.onConfigure;
        node.onConfigure = function (...args) {
            const result = onConfigure?.apply(this, args);
            resolved = null;
            queueMicrotask(updateBrowse);
            return result;
        };
        const onExecuted = node.onExecuted;
        node.onExecuted = function (message, ...args) {
            const result = onExecuted?.call(this, message, ...args);
            resolved = Object.fromEntries(fields.map((name) => [
                name, { link: getLink(name), text: message[name]?.[0] },
            ]));
            if (message.load_source?.[0] && editor.value === message.editor_at_run?.[0]
                && typeof resolved.text.text === "string") {
                editor.value = resolved.text.text;
                if (sourceText) sourceText.value = message.source_text?.[0] ?? "";
                useEditor.value = true;
                changed();
            }
            return result;
        };
        updateBrowse();
    },
});
