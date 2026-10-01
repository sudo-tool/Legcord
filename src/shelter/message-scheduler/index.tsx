/// <reference path="../../../node_modules/@uwu/shelter-defs/dist/shelter-defs/rootdefs.d.ts" />
import { createSignal, For, Show } from "solid-js";

const {
    flux: { dispatcher, storesFlat },
    plugin: { store },
    ui: { ModalRoot, ModalBody, ModalHeader, ModalSizes, Button, TextBox, showToast, injectCss },
    util: { log },
    observeDom,
} = shelter;

interface ScheduledMessage {
    id: string;
    channelId: string;
    channelName: string;
    content: string;
    sendAt: number;
    createdAt: number;
}

store.scheduledMessages ??= [] as ScheduledMessage[];

function getScheduled(): ScheduledMessage[] {
    if (!Array.isArray(store.scheduledMessages)) store.scheduledMessages = [];
    return store.scheduledMessages as ScheduledMessage[];
}

function saveScheduled(list: ScheduledMessage[]) {
    store.scheduledMessages = list;
    try {
        shelter.plugin.flushStore();
    } catch {
        /* store auto-saves top-level assignment */
    }
}

function currentChannel(): { id: string; name: string } {
    try {
        const id = storesFlat.SelectedChannelStore?.getChannelId?.() as string | undefined;
        if (!id) return { id: "", name: "" };
        const chan = storesFlat.ChannelStore?.getChannel?.(id) as { name?: string } | undefined;
        return { id, name: chan?.name ?? id };
    } catch {
        return { id: "", name: "" };
    }
}

async function sendScheduled(msg: ScheduledMessage): Promise<boolean> {
    try {
        await shelter.http.ready;
        const post = shelter.http.post;
        if (typeof post !== "function") throw new Error("HTTP API unavailable");
        const res = await post({
            url: `/channels/${msg.channelId}/messages`,
            body: { content: msg.content },
        });
        return res?.ok !== false;
    } catch (e) {
        console.warn("[MessageScheduler] send failed:", e);
        return false;
    }
}

let timer: ReturnType<typeof setInterval> | undefined;
let fabEl: HTMLElement | undefined;
let removeCss: (() => void) | undefined;

async function tick() {
    const now = Date.now();
    const list = getScheduled();
    const due = list.filter((m) => m.sendAt <= now);
    if (due.length === 0) return;
    for (const msg of due) {
        const ok = await sendScheduled(msg);
        const remaining = getScheduled().filter((m) => m.id !== msg.id);
        saveScheduled(remaining);
        refreshFabBadge();
        try {
            showToast(
                ok
                    ? { title: "🕒 Message envoyé", content: msg.content.slice(0, 80), duration: 4000 }
                    : { title: "🕒 Échec d'envoi", content: "Message replanifié supprimé, réessayez.", duration: 4000 },
            );
        } catch {
            /* toasts optional */
        }
    }
}

function refreshFabBadge() {
    const badge = fabEl?.querySelector("[data-ms-count]");
    if (badge) badge.textContent = String(getScheduled().length);
}

function toLocalInputValue(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function SchedulerModal(props: { close: () => void }) {
    const chan = currentChannel();
    const [channelId, setChannelId] = createSignal(chan.id);
    const [content, setContent] = createSignal("");
    const [when, setWhen] = createSignal(toLocalInputValue(Date.now() + 60 * 60 * 1000));
    const [list, setList] = createSignal<ScheduledMessage[]>([...getScheduled()]);

    const refresh = () => setList([...getScheduled()]);

    const add = () => {
        const text = content().trim();
        const cid = channelId().trim();
        const ts = new Date(when()).getTime();
        if (!text || !cid || Number.isNaN(ts)) {
            try {
                showToast({ title: "🕒 Champs incomplets", content: "Contenu, salon et heure requis." });
            } catch {
                /* noop */
            }
            return;
        }
        if (ts <= Date.now()) {
            try {
                showToast({ title: "🕒 Heure invalide", content: "Choisissez une heure dans le futur." });
            } catch {
                /* noop */
            }
            return;
        }
        let name = cid;
        try {
            name = (storesFlat.ChannelStore?.getChannel?.(cid) as { name?: string } | undefined)?.name ?? cid;
        } catch {
            /* noop */
        }
        const next = [
            ...getScheduled(),
            {
                id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                channelId: cid,
                channelName: name,
                content: text.slice(0, 2000),
                sendAt: ts,
                createdAt: Date.now(),
            },
        ];
        saveScheduled(next);
        refresh();
        refreshFabBadge();
        setContent("");
    };

    const remove = (id: string) => {
        saveScheduled(getScheduled().filter((m) => m.id !== id));
        refresh();
        refreshFabBadge();
    };

    return (
        <ModalRoot size={ModalSizes.MEDIUM}>
            <ModalHeader close={props.close}>🕒 Message Scheduler</ModalHeader>
            <ModalBody>
                <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                    <span style={{ "font-size": "12px", opacity: ".8" }}>Salon ID (par défaut : salon actuel)</span>
                    <TextBox value={channelId()} placeholder="Channel ID" onInput={setChannelId} />
                    <span style={{ "font-size": "12px", opacity: ".8" }}>Message</span>
                    <textarea
                        rows={3}
                        value={content()}
                        placeholder="Préparez votre message…"
                        onInput={(e) => setContent(e.currentTarget.value)}
                        style={{
                            background: "var(--background-tertiary)",
                            color: "var(--text-normal)",
                            border: "1px solid var(--background-modifier-accent)",
                            "border-radius": "8px",
                            padding: "8px",
                        }}
                    />
                    <span style={{ "font-size": "12px", opacity: ".8" }}>Heure d'envoi</span>
                    <input
                        type="datetime-local"
                        value={when()}
                        onInput={(e) => setWhen(e.currentTarget.value)}
                        style={{
                            background: "var(--background-tertiary)",
                            color: "var(--text-normal)",
                            border: "1px solid var(--background-modifier-accent)",
                            "border-radius": "8px",
                            padding: "8px",
                        }}
                    />
                    <Button onClick={add}>Planifier l'envoi</Button>
                </div>
                <hr style={{ opacity: ".2", margin: "12px 0" }} />
                <Show when={list().length > 0} fallback={<p style={{ opacity: ".7" }}>Aucun message planifié.</p>}>
                    <For each={[...list()].sort((a, b) => a.sendAt - b.sendAt)}>
                        {(m) => (
                            <div
                                style={{
                                    border: "1px solid var(--background-modifier-accent)",
                                    "border-radius": "8px",
                                    padding: "8px",
                                    "margin-bottom": "8px",
                                }}
                            >
                                <div style={{ "font-size": "12px", opacity: ".8" }}>
                                    #{m.channelName} • {new Date(m.sendAt).toLocaleString()}
                                </div>
                                <div style={{ margin: "4px 0", "overflow-wrap": "anywhere" }}>{m.content}</div>
                                <Button onClick={() => remove(m.id)}>Annuler</Button>
                            </div>
                        )}
                    </For>
                </Show>
            </ModalBody>
        </ModalRoot>
    );
}

export function settings() {
    const [list, setList] = createSignal<ScheduledMessage[]>([...getScheduled()]);
    return (
        <div>
            <p style={{ opacity: ".8" }}>Messages planifiés : {list().length}</p>
            <Button
                onClick={() => {
                    setList([...getScheduled()]);
                    shelter.plugin.showSettings();
                }}
            >
                Actualiser
            </Button>
        </div>
    );
}

function mountFab() {
    if (fabEl?.isConnected) return;
    fabEl = document.createElement("div");
    fabEl.id = "legcord-msg-scheduler-fab";
    fabEl.innerHTML = `<button title="Planifier un message" style="all:unset;cursor:pointer;font-size:20px;line-height:1">🕒<span data-ms-count style="font-size:11px;vertical-align:top;margin-left:2px">${getScheduled().length}</span></button>`;
    fabEl.querySelector("button")?.addEventListener("click", () => {
        try {
            shelter.ui.openModal((p: { close: () => void }) => <SchedulerModal close={p.close} />);
        } catch (e) {
            console.warn("[MessageScheduler] openModal failed:", e);
        }
    });
    document.body.append(fabEl);
}

export function onLoad() {
    log("Legcord Message Scheduler");
    removeCss = injectCss(`
        #legcord-msg-scheduler-fab {
            position: fixed; right: 16px; bottom: 16px; z-index: 9999;
            background: var(--background-floating, #2b2d31);
            border: 1px solid var(--background-modifier-accent);
            border-radius: 999px; padding: 10px 12px;
            box-shadow: 0 4px 14px rgba(0,0,0,.35);
        }
    `);
    mountFab();
    // Re-mount after Discord re-renders / navigations wipe body children.
    const stopObserve = observeDom("body", () => mountFab());
    (mountFab as unknown as Record<string, unknown>).cleanup = stopObserve;
    timer = setInterval(() => void tick(), 15_000);
    dispatcher.subscribe("CHANNEL_SELECT", () => refreshFabBadge());
}

export function onUnload() {
    if (timer !== undefined) clearInterval(timer);
    try {
        const stop = (mountFab as unknown as Record<string, unknown>).cleanup as (() => void) | undefined;
        stop?.();
    } catch {
        /* noop */
    }
    fabEl?.remove();
    fabEl = undefined;
    removeCss?.();
}
