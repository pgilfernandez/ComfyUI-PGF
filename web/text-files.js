import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";
import { addFolderEditor } from "./folder-editor.js";
import { addFileRows } from "./file-rows.js";

function addFilePicker(node) {
    const file = node.widgets.find((widget) => widget.name === "file");
    let picking = false;
    const button = node.addWidget("button", "Browse file", null, async () => {
        if (picking) return;
        picking = true;
        try {
            const response = await api.fetchApi("/pgf/pick-file", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ file: file.value }),
            });
            if (!response.headers.get("content-type")?.includes("application/json")) {
                throw new Error(`File picker returned HTTP ${response.status}.`);
            }
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? response.statusText);
            if (result.file === null || !node.graph) return;

            file.value = result.file;
            file.callback?.(file.value, app.canvas, node);
            node.setDirtyCanvas(true, true);
            app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.captureCanvasState?.();
        } catch (error) {
            app.extensionManager.toast.add({
                severity: "error",
                summary: "Could not browse files",
                detail: error.message,
            });
        } finally {
            picking = false;
        }
    }, { serialize: false });
    button.serialize = false;
}

app.registerExtension({
    name: "PGF.TextFiles",
    nodeCreated(node) {
        if (node.comfyClass === "PGFLoadSingleTextFile") {
            addFilePicker(node);
            return;
        }
        const hasEditor = node.comfyClass === "PGFLoadAndEditTextFiles";
        if (node.comfyClass !== "PGFLoadTextFile" && !hasEditor) return;

        const folder = node.widgets.find((widget) => widget.name === (hasEditor ? "folder_path" : "folder"));
        const index = node.widgets.find((widget) => widget.name === "index");
        const getLink = (name) => node.inputs?.find((input) => input.name === name)?.link ?? null;
        let linkedFolder = null;
        let linkedFile = null;
        const activeFolder = () => {
            const link = getLink("folder");
            if (link === null) return folder.value;
            return linkedFolder?.link === link ? linkedFolder.value ?? "" : "";
        };
        const fileLinked = () => getLink("text_file") !== null || getLink("index") !== null;
        index.options.min = 0;
        let pickingFolder = false;
        async function browseFolder() {
            if (pickingFolder || (hasEditor && getLink("folder") !== null)) return;
            pickingFolder = true;
            try {
                const chosenFolder = await pickFolder(folder.value);
                if (chosenFolder === null || !node.graph || (hasEditor && getLink("folder") !== null)) return;

                folder.value = chosenFolder;
                folder.callback(folder.value, app.canvas, node);
                recordWidgetChange();
            } catch (error) {
                app.extensionManager.toast.add({
                    severity: "error",
                    summary: "Could not browse folders",
                    detail: error.message,
                });
            } finally {
                pickingFolder = false;
            }
        }

        async function pickFolder(currentFolder) {
            const response = await api.fetchApi("/pgf/pick-folder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ folder: currentFolder }),
            });
            if (response.status === 404 || response.status === 405) {
                // The extension JavaScript can reload while the Python routes are still from an older session.
                const query = new URLSearchParams({ path: currentFolder });
                const fallback = await api.fetchApi(`/pixaroma/api/load_images_folder/pick_native?${query}`, {
                    cache: "no-store",
                });
                if (!fallback.ok || !isJson(fallback)) {
                    throw new Error("Restart the ComfyUI server to load the folder picker.");
                }
                const result = await fallback.json();
                if (result.ok) return result.path;
                if (result.cancelled) return null;
                throw new Error(result.message ?? (result.busy
                    ? "A folder picker is already open."
                    : "Restart the ComfyUI server to load the PGF folder picker."));
            }
            if (!isJson(response)) {
                throw new Error(`Folder picker returned HTTP ${response.status}. Restart the ComfyUI server and try again.`);
            }
            const result = await response.json();
            if (!response.ok) throw new Error(result.error ?? response.statusText);
            return result.folder;
        }

        function isJson(response) {
            return response.headers.get("content-type")?.includes("application/json");
        }
        const emptyFolder = "Enter a folder path";
        const noSelection = "Select a text file";
        let fileLabels = [];
        let loadEditor;
        function selectFile(label) {
            if (hasEditor && fileLinked()) return;
            const position = fileLabels.indexOf(label);
            if (position < 0) return;

            index.value = position;
            index.callback(position, app.canvas, node);
            recordWidgetChange();
        }

        let files = { options: { values: [emptyFolder] }, value: emptyFolder };
        let rows;
        let syncRows = () => {};
        if (hasEditor) {
            rows = addFileRows(node, {
                browseFolder, refresh, selectFile,
                editFolder(value) {
                    if (folder.value === value) return;
                    folder.value = value;
                    folder.callback(value, app.canvas, node);
                    recordWidgetChange();
                },
            });
            folder.hidden = true;
            folder.options.hidden = true;
            folder.computeSize = () => [0, -4];
            index.hidden = true;
            index.options.hidden = true;
            index.computeSize = () => [0, -4];
            for (const widget of rows.widgets) node.widgets.splice(node.widgets.indexOf(widget), 1);
            node.widgets.splice(node.widgets.indexOf(folder) + 1, 0, ...rows.widgets);
            rows.attachSockets();
            syncRows = () => rows.update({
                path: activeFolder(),
                options: files.options.values,
                selected: files.value,
                hasFiles: fileLabels.length > 0,
                error: files.options.tooltip,
                folderLinked: getLink("folder") !== null,
                fileLinked: fileLinked(),
            });
        } else {
            const browse = node.addWidget("button", "Browse folder", null, browseFolder, { serialize: false });
            files = node.addWidget("combo", "Text file", emptyFolder, selectFile, { values: [emptyFolder], serialize: false });
            const refreshButton = node.addWidget("button", "Refresh files", null, refresh, { serialize: false });
            browse.serialize = files.serialize = refreshButton.serialize = false;
        }

        function showStatus(message) {
            fileLabels = [];
            files.options.values = [message];
            files.value = message;
            syncRows();
            node.setDirtyCanvas(true, true);
        }

        function syncSelection() {
            if (index.value < 0) index.value = 0;
            if (!fileLabels.length) return;

            const position = hasEditor && fileLinked() ? linkedFile?.index : index.value;
            const label = fileLabels[position];
            files.options.values = label === undefined ? [noSelection, ...fileLabels] : fileLabels;
            files.value = label ?? noSelection;
            syncRows();
            node.setDirtyCanvas(true, true);
        }

        function recordWidgetChange() {
            node.setDirtyCanvas(true, true);
            app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.captureCanvasState?.();
        }

        let requestId = 0;
        async function refresh() {
            const currentRequest = ++requestId;
            const path = (hasEditor ? activeFolder() : folder.value).trim();
            delete files.options.tooltip;
            if (!path) {
                showStatus(hasEditor && getLink("folder") !== null ? "Run to load linked folder" : emptyFolder);
                return;
            }

            showStatus("Loading files...");
            try {
                const query = new URLSearchParams({ folder: path });
                const response = await api.fetchApi(`/pgf/text-files?${query}`);
                const result = await response.json();
                if (currentRequest !== requestId) return;
                if (!response.ok) throw new Error(result.error ?? response.statusText);

                if (result.files.length === 0) {
                    showStatus("No .txt files");
                    return;
                }
                fileLabels = result.files.map((name, position) => `${position}: ${name}`);
                syncSelection();
                void loadEditor?.();
            } catch (error) {
                if (currentRequest !== requestId) return;
                files.options.tooltip = error.message;
                showStatus("Could not list files");
            }
        }

        const updateFolder = folder.callback;
        folder.callback = function (...args) {
            const result = updateFolder?.apply(this, args);
            void refresh();
            return result;
        };
        const updateIndex = index.callback;
        index.callback = function (...args) {
            const result = updateIndex?.apply(this, args);
            syncSelection();
            void loadEditor?.();
            return result;
        };

        const configure = node.onConfigure;
        node.onConfigure = function (...args) {
            const result = configure?.apply(this, args);
            rows?.attachSockets();
            linkedFolder = linkedFile = null;
            syncSelection();
            void refresh();
            return result;
        };
        if (hasEditor) {
            loadEditor = addFolderEditor(node, activeFolder, index, recordWidgetChange);
            const onExecuted = node.onExecuted;
            node.onExecuted = function (message, ...args) {
                const folderLink = getLink("folder");
                const nextFolder = message.folder_at_run?.[0];
                const folderChanged = folderLink !== null && linkedFolder?.value !== nextFolder;
                if (folderLink !== null) linkedFolder = { link: folderLink, value: nextFolder };
                linkedFile = fileLinked() ? { index: message.index?.[0] } : null;
                const result = onExecuted?.call(this, message, ...args);
                if (folderChanged) void refresh();
                else syncSelection();
                return result;
            };
            const onConnectionsChange = node.onConnectionsChange;
            node.onConnectionsChange = function (type, slot, ...args) {
                const result = onConnectionsChange?.call(this, type, slot, ...args);
                if (type !== 1 || !["folder", "text_file", "index"].includes(node.inputs?.[slot]?.name)) return result;
                queueMicrotask(() => {
                    rows.attachSockets();
                    if (linkedFolder?.link !== getLink("folder")) linkedFolder = null;
                    linkedFile = null;
                    void refresh();
                });
                return result;
            };
        }
        void refresh();
    },
});
