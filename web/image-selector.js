import { app } from "../../scripts/app.js";

const isImageInput = (input) => /^image_\d+$/.test(input.name);

app.registerExtension({
    name: "PGF.ImageSelector",
    nodeCreated(node) {
        if (node.comfyClass !== "PGFImageSelector") return;

        const indexWidget = node.widgets.find((widget) => widget.name === "index");
        const maxInputs = indexWidget.options.max + 1;

        function updateInputs() {
            const inputs = node.inputs ?? [];
            const imageInputs = inputs.filter(isImageInput);
            const connected = imageInputs.filter((input) => input.link != null);
            const tail = imageInputs.at(-1);
            const spare = tail?.link === null ? tail : null;
            const kept = new Set(spare ? [...connected, spare] : connected);

            let changed = false;
            for (let slot = inputs.length - 1; slot >= 0; slot--) {
                const input = inputs[slot];
                if (isImageInput(input) && !kept.has(input)) {
                    node.removeInput(slot);
                    changed = true;
                }
            }
            connected.forEach((input, position) => {
                const name = `image_${position}`;
                if (input.name !== name) {
                    input.name = name;
                    changed = true;
                }
            });
            if (connected.length < maxInputs) {
                const name = `image_${connected.length}`;
                if (!spare) {
                    node.addInput(name, "IMAGE");
                    changed = true;
                } else if (spare.name !== name) {
                    spare.name = name;
                    changed = true;
                }
            }
            if (changed) {
                const [width, height] = node.computeSize();
                node.setSize([Math.max(node.size[0], width), height]);
                node.setDirtyCanvas(true, true);
            }
        }

        let pending = false;
        function scheduleUpdate() {
            if (pending) return;
            pending = true;
            queueMicrotask(() => {
                pending = false;
                updateInputs();
            });
        }

        const onConnectionsChange = node.onConnectionsChange;
        node.onConnectionsChange = function (type, ...args) {
            const result = onConnectionsChange?.call(this, type, ...args);
            if (type === 1) scheduleUpdate();
            return result;
        };

        const onConfigure = node.onConfigure;
        node.onConfigure = function (...args) {
            const result = onConfigure?.apply(this, args);
            scheduleUpdate();
            return result;
        };

        updateInputs();
    },
});
