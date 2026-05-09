class TripsHubCards {
  async render(dv) {
    const trips = dv.pages('"spice/trips"').where(p => p.type === "trip");

    const parseDate = (dateValue) => {
      if (!dateValue) return null;
      const dateStr = dateValue.toString ? dateValue.toString() : String(dateValue);
      const strict = window.moment(dateStr, ["YYYY-MM-DD", "M/D/YYYY", "MM/DD/YYYY"], true);
      if (strict.isValid()) return strict;
      const loose = window.moment(dateStr);
      if (loose.isValid()) return loose;
      return null;
    };

    const today = window.moment().startOf("day");

    const tripStart = (p) => parseDate(p.start_date) || parseDate(p.date);
    const tripEnd = (p) => parseDate(p.end_date) || parseDate(p.start_date) || parseDate(p.date);

    const groupOf = (p) => {
      const start = tripStart(p);
      const end = tripEnd(p);
      if (start && end && today.isSameOrAfter(start, "day") && today.isSameOrBefore(end, "day")) {
        return "Current Trip";
      }
      if (!start) return "Past Trips";
      if (start.isAfter(today, "day")) return "Upcoming Trips";
      return "Past Trips";
    };

    const sortKey = (p) => {
      const g = groupOf(p);
      const d = tripStart(p);
      const ts = d ? d.valueOf() : 0;
      if (g === "Current Trip")    return [0, ts];
      if (g === "Upcoming Trips")  return [1, ts || Number.POSITIVE_INFINITY];
      return [2, d ? -ts : Number.POSITIVE_INFINITY];
    };

    const planeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`;

    await window.customJS.BeaconCards.render(dv, {
      pages: trips.array(),
      layout: "row",
      group: groupOf,
      title: (p) => p.name || p.file.name,
      icon: () => planeIcon,
      subtitle: (p) => p.location || null,
      meta: (p) => {
        const startDate = parseDate(p.start_date);
        const endDate = parseDate(p.end_date);
        const singleDate = parseDate(p.date);
        let dateDisplay;
        if (startDate && endDate) {
          dateDisplay = `${startDate.format("MMM D")} - ${endDate.format("MMM D, YYYY")}`;
        } else if (singleDate) {
          dateDisplay = singleDate.format("MMM D, YYYY");
        } else {
          dateDisplay = "No date set";
        }
        const isPast = groupOf(p) === "Past Trips";
        const tone = isPast ? "color: var(--text-faint);" : "";
        return `<span style="${tone}">${dateDisplay}</span>`;
      },
      target: (p) => p.file.path,
      sort: (a, b) => {
        const ka = sortKey(a), kb = sortKey(b);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        return ka[1] - kb[1];
      },
      empty: "No trips yet. Click 'New Trip' on the hub to get started."
    });
  }
}
