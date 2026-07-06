class TaskDoneTodayList {

    filterToday(parsedTasks, todayStr) { return TaskDoneTodayList.filterToday(parsedTasks, todayStr); }

    async render(dv) {
        // browser-side implementation added in Task 2
        if (!dv || !dv.container) return;
    }

    /**
     * Filter a list of parsed task objects to those completed on todayStr.
     * @param {object[]} parsedTasks — TaskEntity.parseNote output
     * @param {string} todayStr — 'YYYY-MM-DD'
     * @returns {object[]} tasks where completed_at === todayStr
     */
    static filterToday(parsedTasks, todayStr) {
        if (!Array.isArray(parsedTasks) || !todayStr) return [];
        return parsedTasks.filter(t => t && t.completed_at === todayStr);
    }
}