class TaskDoneArchive {

    groupByDate(parsedTasks) { return TaskDoneArchive.groupByDate(parsedTasks); }
    filterByText(parsedTasks, text) { return TaskDoneArchive.filterByText(parsedTasks, text); }

    async render(dv) {
        // browser-side implementation added in Task 5
        if (!dv || !dv.container) return;
    }

    /**
     * Group parsed task objects by their completed_at date string, sorted
     * newest-first. Tasks with null/empty completed_at are dropped.
     * @param {object[]} parsedTasks — TaskEntity.parseNote output
     * @returns {Map<string, object[]>} dateStr -> tasks[], sorted desc
     */
    static groupByDate(parsedTasks) {
        if (!Array.isArray(parsedTasks)) return new Map();
        const map = new Map();
        for (const t of parsedTasks) {
            if (!t || !t.completed_at) continue;
            if (!map.has(t.completed_at)) map.set(t.completed_at, []);
            map.get(t.completed_at).push(t);
        }
        return new Map([...map.entries()].sort((a, b) =>
            b[0] < a[0] ? -1 : b[0] > a[0] ? 1 : 0));
    }

    /**
     * Filter parsed tasks to those whose title includes text (case-insensitive).
     * Empty/blank text returns all tasks.
     * @param {object[]} parsedTasks
     * @param {string} text
     * @returns {object[]}
     */
    static filterByText(parsedTasks, text) {
        if (!Array.isArray(parsedTasks)) return [];
        if (!text || !text.trim()) return parsedTasks;
        const lower = text.toLowerCase();
        return parsedTasks.filter(t => t && t.title && t.title.toLowerCase().includes(lower));
    }
}