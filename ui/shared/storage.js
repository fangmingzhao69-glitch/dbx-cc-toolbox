// Preference values retain their existing types and keys. Reads settle after any queued write.
export function createPreferences(bridge) {
  let pending = Promise.resolve();
  return {
    async read(key, fallback = null) {
      await pending;
      if (bridge) return await bridge.storage.get(key) ?? fallback;
      return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
    },
    write(key, value) {
      const done = pending.then(async () => {
        if (bridge) await bridge.storage.set(key, value);
        else localStorage.setItem(key, JSON.stringify(value));
      });
      pending = done.catch(() => {});
      return done;
    },
    flush() { return pending; },
  };
}
