class TripSectionKinds {
    // Single source of truth for the 5 default trip-section kinds. Consumed by
    // TripNavButtons + TripSectionsCards so label/icon/order can never drift.
    all() {
        return [
            { kind: "flights",      label: "Flights",      legacy: "Trip Flights" },
            { kind: "stay",         label: "Stay",         legacy: "Trip Stay" },
            { kind: "packing-list", label: "Packing List", legacy: "Trip Packing List" },
            { kind: "to-do",        label: "To Do",        legacy: "Trip To Do" },
            { kind: "notes",        label: "Notes",        legacy: "Trip Notes" },
        ];
    }
    order(kind) {
        const i = this.all().findIndex(k => k.kind === kind);
        return i === -1 ? 999 : i;
    }
    labelFor(kind) {
        const e = this.all().find(k => k.kind === kind);
        return e ? e.label : null;
    }
    kindFromLegacyBasename(basename) {
        const e = this.all().find(k => k.legacy === basename);
        return e ? e.kind : "custom";
    }
    iconFor(kind) {
        const I = {
            flights:        `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`,
            stay:           `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>`,
            "packing-list": `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M8 10h8"/><path d="M8 18v-4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v4"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
            "to-do":        `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="m9 12 2 2 4-4"/></svg>`,
            notes:          `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
        };
        return I[kind] || I.notes;
    }
}
