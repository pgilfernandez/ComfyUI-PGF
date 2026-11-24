import { api } from "../../scripts/api.js";
import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "PGF.TextFiles",
    nodeCreated(node) {
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
        const row = document.createElement("div");
        row.style.cssText = "display:flex;gap:4px;align-items:center;width:100%";

        const select = document.createElement("select");
        select.setAttribute("aria-label", "Text file");
        select.style.cssText = "flex:1;min-width:0";
        const refreshButton = document.createElement("button");
        refreshButton.type = "button";
        refreshButton.textContent = "Refresh";
        refreshButton.title = "Refresh the text files in this folder";
        row.append(select, refreshButton);
        node.addDOMWidget("text_files", "pgf_text_files", row, {
            serialize: false,
            getMinHeight: () => 28,
        });

        function showStatus(message) {
            select.replaceChildren(new Option(message, ""));
            select.disabled = true;
        }

        function syncSelection() {
            if (!select.disabled) select.value = String(index.value);
        }

        function recordWidgetChange() {
            node.setDirtyCanvas(true, true);
            app.extensionManager?.workflow?.activeWorkflow?.changeTracker?.captureCanvasState?.();
        }

        let requestId = 0;
        async function refresh() {
            const currentRequest = ++requestId;
            const path = folder.value.trim();
            select.title = "";
            if (!path) {
                showStatus("Enter a folder path");
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
                select.replaceChildren(...result.files.map((name, position) => (
                    new Option(`${position}: ${name}`, String(position))
                )));
                select.disabled = false;
                syncSelection();
            } catch (error) {
                if (currentRequest !== requestId) return;
                showStatus("Could not list files");
                select.title = error.message;
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

        select.addEventListener("change", () => {
            index.value = Number(select.value);
            index.callback(index.value, app.canvas, node);
            recordWidgetChange();
        });
        refreshButton.addEventListener("click", refresh);

        const configure = node.onConfigure;
        node.onConfigure = function (...args) {
            const result = configure?.apply(this, args);
            void refresh();
            return result;
        };
        void refresh();
    },
});
