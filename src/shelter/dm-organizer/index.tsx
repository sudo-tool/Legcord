/// <reference path="../../../node_modules/@uwu/shelter-defs/dist/shelter-defs/rootdefs.d.ts" />
import { createSignal, For, Show } from "solid-js";

const {
    flux: { dispatcher, storesFlat },
    plugin: { store },
    ui: { Button, Select, SelectOption, showToast, injectCss },
    util: { log },
    observeDom,
} = shelter;

export const DM_CATEGORIES = [
    { id: "favorites", emoji: "⭐", label: "Favoris" },
    { id: "friends", emoji: "👥", label: "Amis" },
    { id: "dev", emoji: "💻", label: "Dev" },
    { id: "gaming", emoji: "🎮", label: "Gaming" },
    { id: "school", emoji: "📚", label: "École" },
] as const;

export type DmCategoryId = (typeof DM_CATEGORIES)[number]["id"] | "none";

store.dmCategories ??= {} as Record<string, DmCategoryId>;
store.dmFilter ??= "all" as string;

function getCategories(): Record<string, DmCategoryId> {
    const raw = store.dmCategories as Record<string, DmCategoryId> | undefined;
    if (!raw || typeof raw !== "object") store.dmCategories = {};
    return store.dmCategories as Record<string, DmCategoryId>;
}

function getFilter(): string {
    return typeof store.dmFilter === "string" ? store.dmFilter : "all";
}

function setFilter(f: string) {
    store.dmFilter = f;
    try {
        shelter.plugin.flushStore();
    } catch {
        /* noop */
    }
    applyFilter();
    renderFilterBar();
}

function categoryOf(channelId: string): DmCategoryId {
    return getCategories()[channelId] ?? "none";
}

function categoryMeta(id: string) {
    return DM_CATEGORIES.find((c) => c.id === id);
}

function currentDmChannelId(): string {
    try {
        return String(storesFlat.SelectedChannelStore?.getChannelId?.() ?? "");
    } catch {
        return "";
    }
}

function assignCurrent(category: DmCategoryId) {
    const id = currentDmChannelId();
    if (!id) return;
    const cats = { ...getCategories() };
    if (category === "none") delete cats[id];
    else cats[id] = category;
    store.dmCategories = cats;
    try {
        shelter.plugin.flushStore();
    } catch {
        /* noop */
    }
    applyFilter();
}

let filterBarEl: HTMLElement | undefined;
let fabEl: HTMLElement | undefined;
let removeCss: (() => void) | undefined;
let filterTimer: ReturnType<typeof setTimeout> | undefined;

function dmAnchors(): HTMLAnchorElement[] {
    // Discord renders DMs as links to /channels/@me/<channelId>
    return [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/channels/@me/"]')];
}

function channelIdFromHref(href: string): string {
    const parts = href.split("/");
    return parts[parts.length - 1] ?? "";
}

export function applyFilter() {
    const filter = getFilter();
    for (const a of dmAnchors()) {
        const href = a.getAttribute("href") ?? "";
        const id = channelIdFromHref(href);
        if (!id) continue;
        const cat = categoryOf(id);
        const row = a.closest("li, div[class*='channel_'], div[class*='interactive_']") as HTMLElement | null;
        const target = row ?? a;
        if (filter === "all" || filter === "none" ? cat === "none" : cat === filter) {
            target.style.display = "";
            target.style.opacity = "";
        } else {
            target.style.display = "none";
        }
        // Badge the category on the row for clarity.
        const meta = categoryMeta(cat);
        let badge = a.querySelector("[data-legcord-dm-cat]");
        if (meta && !badge) {
            badge = document.createElement("span");
            badge.setAttribute("data-legcord-dm-cat", cat);
            badge.textContent = ` ${meta.emoji}`;
            badge.setAttribute("title", meta.label);
            a.append(badge);
        } else if (!meta && badge) {
            badge.remove();
        } else if (meta && badge) {
            badge.textContent = ` ${meta.emoji}`;
        }
    }
}

function scheduleApplyFilter() {
    if (filterTimer !== undefined) clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilter, 250);
}

function renderFilterBar() {
    if (!filterBarEl) return;
    const active = getFilter();
    const counts = new Map<string, number>();
    for (const a of dmAnchors()) {
        const cat = categoryOf(channelIdFromHref(a.getAttribute("href") ?? ""));
        counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    filterBarEl.innerHTML = "";
    const mk = (id: string, label: string) => {
        const b = document.createElement("button");
        b.textContent = `${label}${id === active ? " ✓" : ""}`;
        b.dataset.active = String(id === active);
        b.onclick = () => setFilter(id);
        filterBarEl!.append(b);
    };
    mk("all", `Tous (${dmAnchors().length})`);
    for (const c of DM_CATEGORIES) mk(c.id, `${c.emoji} ${c.label} (${counts.get(c.id) ?? 0})`);
    mk("none", `Sans catégorie (${counts.get("none") ?? 0})`);
}

function mountFilterBar() {
    // Anchor above the DM list; fall back to a floating mini-bar.
    const nav =
        (document.querySelector('nav[aria-label*="Direct" i], nav[aria-label*="Private" i]') as HTMLElement | null) ??
        (document.querySelector("div[class*='privateChannels_']") as HTMLElement | null);
    if (!filterBarEl) {
        filterBarEl = document.createElement("div");
        filterBarEl.id = "legcord-dm-filter";
    }
    renderFilterBar();
    if (nav && filterBarEl.parentElement !== nav) {
        nav.prepend(filterBarEl);
    } else if (!nav && !filterBarEl.isConnected) {
        filterBarEl.classList.add("legcord-dm-filter-floating");
        document.body.append(filterBarEl);
    }
    applyFilter();
}

function mountFab() {
    if (fabEl?.isConnected) return;
    fabEl = document.createElement("div");
    fabEl.id = "legcord-dm-organizer-fab";
    fabEl.innerHTML = `<button title="Classer cette conversation">🗂️</button>`;
    fabEl.querySelector("button")?.addEventListener("click", () => {
        const id = currentDmChannelId();
        const cur = id ? categoryOf(id) : "none";
        try {
            shelter.ui.openModal((p: { close: () => void }) => (
                <OrganizerModal close={p.close} channelId={id} current={cur} />
            ));
        } catch (e) {
            console.warn("[DmOrganizer] openModal failed:", e);
        }
    });
    document.body.append(fabEl);
}

function OrganizerModal(props: { close: () => void; channelId: string; current: string }) {
    const [cat, setCat] = createSignal<string>(props.current);
    return (
        <shelter.ui.ModalRoot size={shelter.ui.ModalSizes.SMALL}>
            <shelter.ui.ModalHeader close={props.close}>🗂️ DM Organizer</shelter.ui.ModalHeader>
            <shelter.ui.ModalBody>
                <p style={{ opacity: ".8" }}>Classer le salon : {props.channelId || "(aucun salon sélectionné)"}</p>
                <Select value={cat()} onChange={(v) => setCat(String(v))}>
                    <SelectOption value="none">Sans catégorie</SelectOption>
                    <For each={DM_CATEGORIES}>
                        {(c) => <SelectOption value={c.id}>{`${c.emoji} ${c.label}`}</SelectOption>}
                    </For>
                </Select>
                <div style={{ margin: "12px 0" }}>
                    <Button
                        onClick={() => {
                            assignCurrent(cat() as DmCategoryId);
                            try {
                                showToast({ title: "🗂️ Conversation classée", content: cat() });
                            } catch {
                                /* noop */
                            }
                            props.close();
                        }}
                    >
                        Enregistrer
                    </Button>
                </div>
            </shelter.ui.ModalBody>
        </shelter.ui.ModalRoot>
    );
}

export function settings() {
    const [cats, setCats] = createSignal<Record<string, DmCategoryId>>({ ...getCategories() });
    const refresh = () => setCats({ ...getCategories() });
    return (
        <div>
            <p style={{ opacity: ".8" }}>
                Classez vos conversations : ⭐ Favoris, 👥 Amis, 💻 Dev, 🎮 Gaming, 📚 École.
            </p>
            <div style={{ display: "flex", gap: "6px", "flex-wrap": "wrap", margin: "8px 0" }}>
                <For each={["all", ...DM_CATEGORIES.map((c) => c.id), "none"]}>
                    {(f) => <Button onClick={() => setFilter(f)}>Voir : {f}</Button>}
                </For>
            </div>
            <For each={Object.entries(cats())}>
                {([channelId, cat]) => (
                    <div style={{ margin: "4px 0", opacity: ".9" }}>
                        {channelId} → {cat}{" "}
                        <Button
                            onClick={() => {
                                const next = { ...getCategories() };
                                delete next[channelId];
                                store.dmCategories = next;
                                try {
                                    shelter.plugin.flushStore();
                                } catch {
                                    /* noop */
                                }
                                refresh();
                                applyFilter();
                            }}
                        >
                            Retirer
                        </Button>
                    </div>
                )}
            </For>
            <Show when={Object.keys(cats()).length === 0}>
                <p style={{ opacity: ".7" }}>Aucune conversation classée pour l'instant.</p>
            </Show>
        </div>
    );
}

export function onLoad() {
    log("Legcord DM Organizer");
    removeCss = injectCss(`
        #legcord-dm-filter { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; }
        #legcord-dm-filter button {
            font-size: 11px; cursor: pointer; border-radius: 999px; padding: 3px 8px;
            background: var(--background-tertiary); color: var(--text-normal);
            border: 1px solid var(--background-modifier-accent);
        }
        #legcord-dm-filter button[data-active="true"] { outline: 2px solid var(--brand-500, #5865f2); }
        #legcord-dm-filter.legcord-dm-filter-floating {
            position: fixed; left: 12px; bottom: 12px; z-index: 9998; max-width: 320px;
            background: var(--background-floating, #2b2d31); border-radius: 10px;
            border: 1px solid var(--background-modifier-accent);
        }
        #legcord-dm-organizer-fab {
            position: fixed; right: 16px; bottom: 64px; z-index: 9999;
            background: var(--background-floating, #2b2d31);
            border: 1px solid var(--background-modifier-accent);
            border-radius: 999px; padding: 10px 12px;
            box-shadow: 0 4px 14px rgba(0,0,0,.35); font-size: 20px;
        }
        #legcord-dm-organizer-fab button { all: unset; cursor: pointer; }
    `);
    mountFilterBar();
    mountFab();
    const stopObserve = observeDom("a[href^='/channels/@me/'], nav", () => {
        mountFilterBar();
        scheduleApplyFilter();
    });
    const cleanups = [stopObserve];
    (mountFilterBar as unknown as Record<string, unknown>).cleanup = () => {
        for (const c of cleanups) c();
    };
    dispatcher.subscribe("CHANNEL_SELECT", () => scheduleApplyFilter());
}

export function onUnload() {
    dispatcher.unsubscribe("CHANNEL_SELECT", () => scheduleApplyFilter());
    try {
        const stop = (mountFilterBar as unknown as Record<string, unknown>).cleanup as (() => void) | undefined;
        stop?.();
    } catch {
        /* noop */
    }
    if (filterTimer !== undefined) clearTimeout(filterTimer);
    filterBarEl?.remove();
    filterBarEl = undefined;
    fabEl?.remove();
    fabEl = undefined;
    removeCss?.();
    // Restore hidden DMs.
    for (const a of dmAnchors()) {
        const row = a.closest("li, div") as HTMLElement | null;
        if (row) row.style.display = "";
        a.querySelector("[data-legcord-dm-cat]")?.remove();
    }
}
