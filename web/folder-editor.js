import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

export function addFolderEditor(node, activeFolder, index, recordWidgetChange) {
    const editor = node.widgets.find((widget) => widget.name === "editor");
    const source = node.widgets.find((widget) => widget.name === "editor_source");
    const editorSize = editor.computeSize;
    const toast = (severity, summary, detail) => app.extensionManager.toast.add({ severity, summary, detail });
    let loaded = null;
    let saving = false;
    let loadRequest = 0;

    function setHidden(widget, hidden, originalSize) {
        widget.hidden = hidden;
        widget.options.hidden = hidden;
        widget.computeSize = hidden ? () => [0, -4] : originalSize;
    }
    setHidden(source, true);

    const getLink = (name) => node.inputs?.find((input) => input.name === name)?.link ?? null;

    function selectionMatches(file) {
        return file.folderLink === getLink("folder")
            && file.indexLink === getLink("index")
            && file.textFileLink === getLink("text_file")
            && file.folder === activeFolder()
            && (file.textFileLink !== null || file.indexLink !== null || file.index === Math.max(0, index.value));
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

    const toggle = node.addWidget("button", "show editor", null, () => {
        node.properties.pgfEditorHidden = node.properties.pgfEditorHidden === false;
        updateVisibility();
        recordWidgetChange();
        void loadSelection();
    }, { serialize: false });
    toggle.serialize = false;
    node.widgets.splice(node.widgets.indexOf(toggle), 1);
    node.widgets.splice(node.widgets.indexOf(index) + 1, 0, toggle);

    const editorHidden = () => node.properties.pgfEditorHidden !== false;

    function updateVisibility(resize = true) {
        const hidden = editorHidden();
        toggle.label = hidden ? "show editor" : "hide editor";
        setHidden(editor, hidden, editorSize);
        setHidden(save, hidden, saveSize);
        if (resize) {
            const [width, height] = node.computeSize();
            node.setSize([Math.max(node.size[0], width), height]);
        }
    }

    async function loadSelection() {
        const requestId = ++loadRequest;
        const selectedFolder = activeFolder();
        const folderLink = getLink("folder");
        if (editorHidden() || !selectedFolder.trim() || getLink("index") !== null || getLink("text_file") !== null) return;

        const selectedIndex = Math.max(0, index.value);
        const editorBeforeLoad = editor.value;
        const isCurrent = () => requestId === loadRequest && !editorHidden() && node.graph
            && activeFolder() === selectedFolder && Math.max(0, index.value) === selectedIndex
            && getLink("folder") === folderLink && getLink("index") === null && getLink("text_file") === null;
        try {
            const response = await api.fetchApi("/pgf/load-editable-text", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ folder: selectedFolder, index: selectedIndex }),
            });
            const result = await response.json();
            if (!isCurrent()) return;
            if (!response.ok) throw new Error(result.error ?? response.statusText);
            applyLoaded({
                source: result.editor_source, path: result.path, filename: result.filename,
                index: result.index, folder: result.folder_at_run, folderLink, indexLink: null, textFileLink: null,
            }, result.text, editorBeforeLoad);
        } catch (error) {
            if (isCurrent()) toast("error", "Could not load text", error.message);
        }
    }

    function applyLoaded(selected, text, editorBeforeLoad) {
        loaded = selected.source ? selected : null;
        if (loaded && selectionMatches(loaded) && source.value !== loaded.source && editor.value === editorBeforeLoad) {
            editor.value = text;
            source.value = loaded.source;
            recordWidgetChange();
        }
    }

    const onConfigure = node.onConfigure;
    node.onConfigure = function (...args) {
        const result = onConfigure?.apply(this, args);
        loaded = null;
        loadRequest++;
        updateVisibility(false);
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
            textFileLink: getLink("text_file"),
        };
        applyLoaded(selected, message.text?.[0], message.editor_at_run?.[0]);
        return result;
    };
    updateVisibility();
    return loadSelection;
}
