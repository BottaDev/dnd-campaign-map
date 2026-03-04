export const MAP = {
  imageUrl: "ExandriaMap.jpeg",
  width: 8100,
  height: 5400,
};

export const characters = [
  { id: "sorfon",  name: "Sorfon",  color: "#2b6cb0", enabled: true },
  { id: "ayax",    name: "Ayax",    color: "#b83280", enabled: true },
  { id: "mortis",  name: "Mortis",  color: "#2f855a", enabled: true },
  { id: "ereldra", name: "Ereldra", color: "#805ad5", enabled: true },
];

export const routes = [
  {
    characterId: "sorfon",
    points: [
      { y: 3130, x: 6342, date: "2026-01-01", label: "Trostenwald" },
      { y: 2891, x: 6317, date: "2026-01-01", label: "Wuyun Gates" },
      { y: 2655, x: 6156, date: "2026-01-01", label: "Nicodranas" },
      { y: 2743, x: 5960, date: "2026-01-01", label: "Port Zoon" },
      { y: 2895, x: 5941, date: "2026-01-01", label: "Feolinn" },
      { y: 3030, x: 5603, date: "2026-01-01", label: "Port Damali" },
    ],
  },
];

export const events = [
  {
    id: "s0_01",
    date: "2026-01-01",
    session: 0,
    title: "Sorfon departs Trostenwald",
    summary: "Sorfon leaves Trostenwald under oath, following a lead toward the Menagerie Coast.",
    y: 3130, x: 6342,
    tags: ["session0", "travel", "intro", "hook"],
    characterIds: ["sorfon"],
  },
  {
    id: "s0_02",
    date: "2026-01-06",
    session: 0,
    title: "Port Damali: the hook",
    summary: "Sorfon arrives in Port Damali. A name/symbol/message connects directly to the campaign’s first real problem.",
    y: 3030, x: 5603,
    tags: ["session0", "travel", "arrival", "hook"],
    characterIds: ["sorfon"],
  },
];