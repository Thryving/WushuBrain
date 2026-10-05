const { store, getSettings, seatsTaken, json } = require('../lib/core');
exports.handler = async (event) => {
  try {
    const s = store(event);
    const st = await getSettings(s);
    let seatsLeft = null;
    if (st.capacity > 0) {
      const left = Math.max(0, st.capacity - await seatsTaken(s));
      if (left <= st.showSeatsLeftBelow) seatsLeft = left;
    }
    const { showSeatsLeftBelow, capacity, ...pub } = st;
    return json(200, { ...pub, seatsLeft, soldOut: st.capacity > 0 && seatsLeft === 0 });
  } catch (e) { return json(500, { error: 'config-failed' }); }
};
