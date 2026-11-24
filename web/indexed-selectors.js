import { app } from "../../scripts/app.js";

const selectorInputs = {
    PGFImageSelector: { prefix: "image", type: "IMAGE" },
    PGFBooleanSelector: { prefix: "boolean", type: "BOOLEAN" },
    PGFDurationSelector: { prefix: "duration", type: "FLOAT" },
};

app.registerExtension({
    name: "PGF.IndexedSelectors",
    nodeCreated(node) {
        const definition = selectorInputs[node.comfyClass];
        if (!definition) return;

        const { prefix, type } = definition;
        const numberedName = new RegExp(`^${prefix}_\\d+$`);
        const isSelectorInput = (input) => numberedName.test(input.name);
        const indexWidget = node.widgets.find((widget) => widget.name === "index");
        const maxInputs = indexWidget.options.max + 1;

        function updateInputs() {
            const inputs = node.inputs ?? [];
            const selectorSlots = inputs.filter(isSelectorInput);
            const connected = selectorSlots.filter((input) => input.link != null);
            const tail = selectorSlots.at(-1);
            const spare = tail?.link === null ? tail : null;
            const kept = new Set(spare ? [...connected, spare] : connected);

            let changed = false;
            for (let slot = inputs.length - 1; slot >= 0; slot--) {
                const input = inputs[slot];
                if (isSelectorInput(input) && !kept.has(input)) {
                    node.removeInput(slot);
                    changed = true;
                }
            }
            const orderedInputs = spare ? [...connected, spare] : connected;
            orderedInputs.forEach((input, position) => {
                const name = `${prefix}_${position}`;
                const hasNumberedLabel = numberedName.test(input.label);
                if (input.name !== name || input.localized_name !== name
                    || (hasNumberedLabel && input.label !== name)) {
                    input.name = name;
                    input.localized_name = name;
                    if (hasNumberedLabel) input.label = name;
                    changed = true;
                }
            });
            if (!spare && connected.length < maxInputs) {
                const name = `${prefix}_${connected.length}`;
                node.addInput(name, type, { localized_name: name });
                changed = true;
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
