import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

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
        if (node.comfyClass !== "PGFLoadTextFile") return;

        const folder = node.widgets.find((widget) => widget.name === "folder");
        const index = node.widgets.find((widget) => widget.name === "index");
        let pickingFolder = false;
        const browseButton = node.addWidget("button", "Browse folder", null, async () => {
            if (pickingFolder) return;
            pickingFolder = true;
            try {
                const chosenFolder = await pickFolder(folder.value);
                if (chosenFolder === null || !node.graph) return;

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
        }, { serialize: false });
        browseButton.serialize = false;

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
        const files = node.addWidget("combo", "Text file", emptyFolder, (label) => {
            const position = fileLabels.indexOf(label);
            if (position < 0) return;

            index.value = position;
            index.callback(position, app.canvas, node);
            recordWidgetChange();
        }, { values: [emptyFolder], serialize: false });
        files.serialize = false;

        const refreshButton = node.addWidget("button", "Refresh files", null, refresh, { serialize: false });
        refreshButton.serialize = false;

        function showStatus(message) {
            fileLabels = [];
            files.options.values = [message];
            files.value = message;
            node.setDirtyCanvas(true, true);
        }

        function syncSelection() {
            if (!fileLabels.length) return;

            const label = fileLabels[index.value];
            files.options.values = label === undefined ? [noSelection, ...fileLabels] : fileLabels;
            files.value = label ?? noSelection;
            node.setDirtyCanvas(true, true);
        }

        function recordWidgetChange() {
            node.setDirtyCanvas(true, true);
            app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.captureCanvasState?.();
        }

        let requestId = 0;
        async function refresh() {
            const currentRequest = ++requestId;
            const path = folder.value.trim();
            delete files.options.tooltip;
            if (!path) {
                showStatus(emptyFolder);
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
            } catch (error) {
                if (currentRequest !== requestId) return;
                showStatus("Could not list files");
                files.options.tooltip = error.message;
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
            return result;
        };

        const configure = node.onConfigure;
        node.onConfigure = function (...args) {
            const result = configure?.apply(this, args);
            void refresh();
            return result;
        };
        void refresh();
    },
});
