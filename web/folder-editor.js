import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

export function addFolderEditor(node, folder, index, recordWidgetChange) {
    const editor = node.widgets.find((widget) => widget.name === "editor");
    const source = node.widgets.find((widget) => widget.name === "editor_source");
    const editorSize = editor.computeSize;
    const toast = (severity, summary, detail) => app.extensionManager.toast.add({ severity, summary, detail });
    let loaded = null;
    let saving = false;

    function setHidden(widget, hidden, originalSize) {
        widget.hidden = hidden;
        widget.options.hidden = hidden;
        widget.computeSize = hidden ? () => [0, -4] : originalSize;
    }
    setHidden(source, true);

    const toggle = node.addWidget("button", "Show / hide editor", null, () => {
        node.properties.pgfEditorHidden = !node.properties.pgfEditorHidden;
        updateVisibility();
        recordWidgetChange();
    }, { serialize: false });
    toggle.serialize = false;

    const getLink = (name) => node.inputs?.find((input) => input.name === name)?.link ?? null;

    function selectionMatches(file) {
        return file.folderLink === getLink("folder")
            && file.indexLink === getLink("index")
            && (file.folderLink !== null || file.folder === folder.value)
            && (file.indexLink !== null || file.index === Math.max(0, index.value));
    }

    const save = node.addWidget("button", "Save .txt", null, async () => {
        if (saving) return;
        if (!loaded || source.value !== loaded.source || !selectionMatches(loaded)) {
            toast("warn", "No file ready to save", "Run the workflow with the desired folder and file selected.");
            return;
        }
        saving = true;
        try {
            const response = await api.fetchApi("/pgf/save-edited-text", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    path: loaded.path, filename: loaded.filename, text: editor.value, existing_file: true,
                }),
            });
            if (!response.headers.get("content-type")?.includes("application/json")) {
                throw new Error(`ComfyUI returned HTTP ${response.status}.`);
            }
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? response.statusText);
            toast("success", "Text saved", result.file);
        } catch (error) {
            toast("error", "Could not save text", error.message);
        } finally {
            saving = false;
        }
    }, { serialize: false });
    save.serialize = false;
    const saveSize = save.computeSize;

    function updateVisibility() {
        const hidden = Boolean(node.properties.pgfEditorHidden);
        setHidden(editor, hidden, editorSize);
        setHidden(save, hidden, saveSize);
        const [width, height] = node.computeSize();
        node.setSize([Math.max(node.size[0], width), height]);
    }

    const onConfigure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = onConfigure?.apply(this, args);
        loaded = null;
        updateVisibility();
        return result;
    };
    const onExecuted = node.onExecuted;
    node.onExecuted = function (message, ...args) {
        const result = onExecuted?.call(this, message, ...args);
        const selected = {
            source: message.editor_source?.[0],
            path: message.path?.[0],
            filename: message.filename?.[0],
            index: message.index?.[0],
            folder: message.folder_at_run?.[0],
            folderLink: getLink("folder"),
            indexLink: getLink("index"),
        };
        loaded = selected.source ? selected : null;
        if (loaded && selectionMatches(loaded) && source.value !== loaded.source
            && editor.value === message.editor_at_run?.[0]) {
            editor.value = message.text[0];
            source.value = loaded.source;
            recordWidgetChange();
        }
        return result;
    };
    updateVisibility();
}
