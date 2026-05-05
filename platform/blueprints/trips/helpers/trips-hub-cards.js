class TripsHubCards {
  async render(dv) {
    const trips = dv.pages('"beacon/trips" AND #trip')
      .where(p => p.file.name !== "Trips")
      .where(p => p.file.folder !== "beacon/trips");

    if (trips.length === 0) {
      dv.paragraph("*No trips yet. Click 'New Trip' on the hub to get started.*");
      return;
    }

    const parseDate = (dateValue) => {
      if (!dateValue) return null;
      const dateStr = dateValue.toString ? dateValue.toString() : String(dateValue);
      const strict = window.moment(dateStr, ["YYYY-MM-DD", "M/D/YYYY", "MM/DD/YYYY"], true);
      if (strict.isValid()) return strict;
      const loose = window.moment(dateStr);
      if (loose.isValid()) return loose;
      return null;
    };

    const tripsWithDates = trips.array().map(trip => ({
      trip,
      sortDate: parseDate(trip.start_date) || parseDate(trip.date)
    }));

    const today = window.moment().startOf("day");

    const upcoming = tripsWithDates
      .filter(t => t.sortDate && t.sortDate.isSameOrAfter(today))
      .sort((a, b) => a.sortDate.valueOf() - b.sortDate.valueOf());

    const past = tripsWithDates
      .filter(t => !t.sortDate || t.sortDate.isBefore(today))
      .sort((a, b) => {
        if (!a.sortDate) return 1;
        if (!b.sortDate) return -1;
        return b.sortDate.valueOf() - a.sortDate.valueOf();
      });

    const allTrips = [...upcoming, ...past];

    const planeIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--interactive-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`;

    const items = allTrips.map(({ trip, sortDate }) => {
      const startDate = parseDate(trip.start_date);
      const endDate = parseDate(trip.end_date);
      const singleDate = parseDate(trip.date);
      let dateDisplay;
      if (startDate && endDate) {
        dateDisplay = `${startDate.format("MMM D")} - ${endDate.format("MMM D, YYYY")}`;
      } else if (singleDate) {
        dateDisplay = singleDate.format("MMM D, YYYY");
      } else {
        dateDisplay = "No date set";
      }
      const isPast = sortDate && sortDate.isBefore(today);
      return {
        title: trip.file.name,
        subtitle: trip.location || "",
        meta: dateDisplay,
        icon: planeIcon,
        path: trip.file.path,
        dim: !!isPast
      };
    });

    await window.customJS.BeaconCards.render(dv, items, { layout: "row" });
  }
}
