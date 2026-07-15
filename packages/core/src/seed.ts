/* Static fallbacks for fields SystemMonitor can't measure (cuda core count
 * isn't queryable via nvidia-smi). storage is overwritten by live statfs of
 * the settings store's data root once the first disk poll lands.
 *
 * Projects and jobs are no longer seeded — the ProjectStore and the persisted
 * job history in <dataRoot>/jobs.json are the real thing. */

export const systemFallback = {
  gpu: "NVIDIA GeForce RTX 3090 Ti",
  driver: "566.36",
  cudaCores: "10 752",
  vram: "24 GB GDDR6X",
  ram: "64 GB",
  storage: "2.1 TB free",
  tempC: 62,
};

export const seedVram = { used: 18.2, allocated: 21.4, total: 24 };
