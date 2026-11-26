const icons = {
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 9a7 7 0 0 1 12-2l2 5M4 12l2 5a7 7 0 0 0 12-2"/>',
};

let styleLoaded = false;

export function addFileRows(node, actions) {
    if (!styleLoaded) {
        const style = document.createElement("link");
        style.rel = "stylesheet";
        style.href = new URL("./file-rows.css", import.meta.url).href;
        document.head.append(style);
        styleLoaded = true;
    }

    const folder = document.createElement("input");
    folder.type = "text";
    folder.spellcheck = false;
    folder.setAttribute("aria-label", "folder");
    folder.addEventListener("change", () => actions.editFolder(folder.value));
    folder.addEventListener("keydown", (event) => {
        if (event.key === "Enter") folder.blur();
    });

    const files = document.createElement("select");
    files.setAttribute("aria-label", "text file");
    files.addEventListener("change", () => actions.selectFile(files.value));

    function addRow(inputName, label, field, icon, buttonLabel, action) {
        const row = document.createElement("div");
        row.className = "pgf-file-row";
        const caption = document.createElement("span");
        caption.textContent = label;
        const group = document.createElement("div");
        group.className = "pgf-file-group";
        const button = document.createElement("button");
        button.type = "button";
        button.title = buttonLabel;
        button.setAttribute("aria-label", buttonLabel);
        button.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[icon]}</svg>`;
        button.addEventListener("click", action);
        group.append(field, button);
        row.append(caption, group);
        const widget = node.addDOMWidget(`pgf_${inputName}_row`, "pgf_file_row", row, { serialize: false });
        widget.serialize = false;
        // Nodes 2.0 treats widgets with computeLayoutSize as vertically expandable.
        widget.computeLayoutSize = undefined;
        widget.computeSize = (width) => [width, 28];
        return { button, widget };
    }

    const folderRow = addRow("folder", "folder", folder, "folder", "Browse folder", actions.browseFolder);
    const fileRow = addRow("text_file", "text file", files, "refresh", "Refresh files", actions.refresh);
    const sockets = [
        ["folder", "STRING", folderRow.widget],
        ["text_file", "INT", fileRow.widget],
    ];

    return {
        widgets: sockets.map(([, , widget]) => widget),
        attachSockets() {
            for (const [name, type, widget] of sockets) {
                let slot = node.inputs?.find((input) => input.name === name);
                if (!slot) {
                    node.addInput(name, type, { widget: { name: widget.name } });
                    slot = node.inputs?.at(-1);
                }
                if (!slot) continue;
                if (slot.type !== type) slot.type = type;
                if (slot.widget?.name !== widget.name) {
                    slot.widget = { ...slot.widget, name: widget.name };
                }
                // Connected values are displayed by the row; keep the row visible.
                widget.connectionSuppressed = false;
            }
        },
        update({ path, options, selected, hasFiles, error, folderLinked, fileLinked }) {
            if (document.activeElement !== folder && folder.value !== path) folder.value = path;
            folder.disabled = folderRow.button.disabled = folderLinked;
            folder.placeholder = folderLinked ? "Run to load linked folder" : "";
            files.replaceChildren(...options.map((name) => new Option(name, name)));
            files.value = selected;
            files.disabled = !hasFiles || fileLinked;
            files.title = error ?? "";
        },
    };
}
