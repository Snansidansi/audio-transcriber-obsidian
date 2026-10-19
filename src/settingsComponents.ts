export interface SettingsTab<T extends string> {
    id: T;
    label: string;
}

export function renderSettingsTabs<T extends string>(
    containerEl: HTMLElement,
    tabs: SettingsTab<T>[],
    activeTab: T,
    onSelect: (tab: T) => void,
): void {
    const tabList = containerEl.createDiv({
        cls: "audio-transcriber-settings-tabs",
        attr: { role: "tablist", "aria-label": "Settings sections" },
    });

    for (const tab of tabs) {
        const button = tabList.createEl("button", {
            text: tab.label,
            cls: tab.id === activeTab ? "is-active" : "",
            attr: {
                type: "button",
                role: "tab",
                "aria-selected": tab.id === activeTab ? "true" : "false",
            },
        });
        button.addEventListener("click", () => onSelect(tab.id));
    }
}
