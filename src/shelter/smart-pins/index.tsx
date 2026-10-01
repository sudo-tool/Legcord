/// <reference path="../../../node_modules/@uwu/shelter-defs/dist/shelter-defs/rootdefs.d.ts" />
import { createSignal, For, Show } from "solid-js";

const {
    flux: { dispatcher },
    plugin: { store },
    ui: { Button, TextBox, showToast, injectCss },
    util: { log },
    observeDom,
} = shelter;

interface SmartPin {
    id: string;
    channelId: string;
    channelName: string;
    content: string;
    createdAt: number;
}

store.smartPins ??= [] as SmartPin[];
store.smartPinsCollapsed ??= false as boolean;

function getPins(): SmartPin[] {
    if (!Array.isArray(store.smartPins)) store.smartPins = [];
    return store.smartPins as SmartPin[];
}

function savePins(pins: SmartPin[]) {
    store.smartPins = pins;
    try {
        shelter.plugin.flushStore();
    } catch {
        /* noop */
    }
}

let barEl: HTMLElement | undefined;
let removeCss: (() => void) | undefined;
let lastMessage: { channelId: string; content: string; author: string } | undefined;

function onMessageCreate(payload: { type: string; channelId?: string; message?: Record<string, unknown> }) {
    try {
        const msg = payload.message as { content?: string; author?: { username?: string } } | undefined;
        if (!msg || typeof msg.content !== "string" || !msg.content) return;
        lastMessage = {
            channelId: String(payload.channelId ?? ""),
            content: msg.content,
            author: msg.author?.username ?? "?",
        };
    } catch {
        /* noop */
    }
}

function channelNameOf(id: string): string {
    try {
        const chan = shelter.flux.storesFlat.ChannelStore?.getChannel?.(id) as { name?: string } | undefined;
        return chan?.name ?? id;
    } catch {
        return id;
    }
}

function renderBar() {
    if (!barEl) return;
    const pins = getPins();
    const collapsed = Boolean(store.smartPinsCollapsed);
    const list = barEl.querySelector("[data-pins-list]");
    if (list) {
        list.innerHTML = "";
        if (!collapsed) {
            for (const pin of [...pins].reverse()) {
                const row = document.createElement("div");
                row.className = "legcord-pin-row";
                const label = document.createElement("span");
                label.className = "legcord-pin-text";
                label.textContent = `#${pin.channelName} — ${pin.content.slice(0, 120)}`;
                label.title = pin.content;
                const jump = document.createElement("button");
                jump.textContent = "↗";
                jump.title = "Aller au salon";
                jump.onclick = () => jumpToChannel(pin.channelId);
                const copy = document.createElement("button");
                copy.textContent = "⧉";
                copy.title = "Copier";
                copy.onclick = () => void navigator.clipboard?.writeText(pin.content).catch(() => {});
                const del = document.createElement("button");
                del.textContent = "✕";
                del.title = "Retirer";
                del.onclick = () => {
                    savePins(getPins().filter((p) => p.id !== pin.id));
                    renderBar();
                };
                row.append(label, jump, copy, del);
                list.append(row);
            }
            if (pins.length === 0) {
                const empty = document.createElement("div");
                empty.className = "legcord-pin-empty";
                empty.textContent = "Aucun pin — épinglez un message important.";
                list.append(empty);
            }
        }
    }
    const count = barEl.querySelector("[data-pins-count]");
    if (count) count.textContent = collapsed ? `📌 ${pins.length}` : `📌 Smart Pins (${pins.length})`;
    const toggle = barEl.querySelector("[data-pins-toggle]");
    if (toggle) toggle.textContent = collapsed ? "▸" : "▾";
    const form = barEl.querySelector("[data-pins-form]") as HTMLElement | null;
    if (form) form.style.display = collapsed ? "none" : "";
    if (list) (list as HTMLElement).style.display = collapsed ? "none" : "";
}

function jumpToChannel(channelId: string) {
    try {
        dispatcher.dispatch({ type: "CHANNEL_SELECT", channelId });
    } catch (e) {
        console.warn("[SmartPins] jump failed:", e);
    }
}

function pinText(channelId: string, content: string) {
    const text = content.trim().slice(0, 2000);
    if (!text) return false;
    savePins([
        ...getPins(),
        {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            channelId,
            channelName: channelNameOf(channelId),
            content: text,
            createdAt: Date.now(),
        },
    ]);
    renderBar();
    return true;
}

function mountBar() {
    if (barEl?.isConnected) {
        renderBar();
        return;
    }
    barEl = document.createElement("div");
    barEl.id = "legcord-smart-pins";
    barEl.innerHTML = `
        <div class="legcord-pins-header">
            <button data-pins-toggle title="Replier / déplier">▾</button>
            <span data-pins-count>📌 Smart Pins</span>
            <button data-pins-last title="Épingler le dernier message reçu">+ dernier</button>
        </div>
        <div data-pins-form class="legcord-pins-form">
            <input data-pins-input placeholder="Épingler un texte important…" maxlength="2000" />
            <button data-pins-add>📌</button>
        </div>
        <div data-pins-list class="legcord-pins-list"></div>
    `;
    (barEl.querySelector("[data-pins-toggle]") as HTMLButtonElement).onclick = () => {
        store.smartPinsCollapsed = !store.smartPinsCollapsed;
        try {
            shelter.plugin.flushStore();
        } catch {
            /* noop */
        }
        renderBar();
    };
    (barEl.querySelector("[data-pins-last]") as HTMLButtonElement).onclick = () => {
        if (!lastMessage) {
            try {
                showToast({ title: "📌 Aucun message récent", content: "En attente d'un nouveau message." });
            } catch {
                /* noop */
            }
            return;
        }
        if (pinText(lastMessage.channelId, `${lastMessage.author}: ${lastMessage.content}`)) {
            try {
                showToast({ title: "📌 Épinglé", content: "Message ajouté à votre barre personnelle." });
            } catch {
                /* noop */
            }
        }
    };
    const input = barEl.querySelector("[data-pins-input]") as HTMLInputElement;
    const submit = () => {
        let channelId = "";
        try {
            channelId = String(shelter.flux.storesFlat.SelectedChannelStore?.getChannelId?.() ?? "");
        } catch {
            /* noop */
        }
        if (pinText(channelId, input.value)) input.value = "";
    };
    (barEl.querySelector("[data-pins-add]") as HTMLButtonElement).onclick = submit;
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
    });
    document.body.append(barEl);
    renderBar();
}

export function settings() {
    const [pins, setPins] = createSignal<SmartPin[]>([...getPins()]);
    const [text, setText] = createSignal("");
    return (
        <div>
            <p style={{ opacity: ".8" }}>Petite barre personnelle — vos pins sont locaux à Legcord.</p>
            <TextBox value={text()} placeholder="Nouveau pin…" onInput={setText} />
            <div style={{ margin: "8px 0" }}>
                <Button
                    onClick={() => {
                        let channelId = "";
                        try {
                            channelId = String(shelter.flux.storesFlat.SelectedChannelStore?.getChannelId?.() ?? "");
                        } catch {
                            /* noop */
                        }
                        if (pinText(channelId, text())) {
                            setText("");
                            setPins([...getPins()]);
                        }
                    }}
                >
                    📌 Épingler
                </Button>
            </div>
            <Show when={pins().length > 0} fallback={<p style={{ opacity: ".7" }}>Aucun pin.</p>}>
                <For each={pins()}>
                    {(p) => (
                        <div style={{ margin: "4px 0", opacity: ".9" }}>
                            #{p.channelName} — {p.content.slice(0, 100)}{" "}
                            <Button
                                onClick={() => {
                                    savePins(getPins().filter((x) => x.id !== p.id));
                                    setPins([...getPins()]);
                                    renderBar();
                                }}
                            >
                                Retirer
                            </Button>
                        </div>
                    )}
                </For>
            </Show>
        </div>
    );
}

export function onLoad() {
    log("Legcord Smart Pins");
    removeCss = injectCss(`
        #legcord-smart-pins {
            position: fixed; top: 48px; right: 12px; z-index: 9998; width: 300px;
            background: var(--background-floating, #2b2d31);
            border: 1px solid var(--background-modifier-accent);
            border-radius: 10px; padding: 8px;
            box-shadow: 0 4px 14px rgba(0,0,0,.35);
            font-size: 13px; color: var(--text-normal);
        }
        #legcord-smart-pins button { cursor: pointer; }
        .legcord-pins-header { display: flex; gap: 6px; align-items: center; font-weight: 600; }
        .legcord-pins-header button { all: unset; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
        .legcord-pins-form { display: flex; gap: 6px; margin-top: 6px; }
        .legcord-pins-form input {
            flex: 1; background: var(--background-tertiary); color: var(--text-normal);
            border: 1px solid var(--background-modifier-accent); border-radius: 6px; padding: 6px;
        }
        .legcord-pins-list { margin-top: 6px; max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 6px; }
        .legcord-pin-row {
            display: flex; gap: 4px; align-items: center;
            border: 1px solid var(--background-modifier-accent); border-radius: 6px; padding: 4px 6px;
        }
        .legcord-pin-text { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .legcord-pin-row button { all: unset; cursor: pointer; padding: 0 4px; opacity: .8; }
        .legcord-pin-empty { opacity: .7; font-size: 12px; }
    `);
    mountBar();
    const stopObserve = observeDom("body", () => mountBar());
    (mountBar as unknown as Record<string, unknown>).cleanup = stopObserve;
    dispatcher.subscribe("MESSAGE_CREATE", onMessageCreate);
}

export function onUnload() {
    dispatcher.unsubscribe("MESSAGE_CREATE", onMessageCreate);
    try {
        const stop = (mountBar as unknown as Record<string, unknown>).cleanup as (() => void) | undefined;
        stop?.();
    } catch {
        /* noop */
    }
    barEl?.remove();
    barEl = undefined;
    removeCss?.();
}
