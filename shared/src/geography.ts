// Official IDQUART/name catalogue, also used in the 2025 population dataset.
// Point-to-neighborhood assignments below are fixed, simulated demo data.
export const NEIGHBORHOODS = [
  {
    id: 1,
    name: "Centro",
  },
  {
    id: 2,
    name: "San Salvario",
  },
  {
    id: 3,
    name: "Crocetta",
  },
  {
    id: 4,
    name: "San Paolo",
  },
  {
    id: 5,
    name: "Cenisia",
  },
  {
    id: 6,
    name: "San Donato",
  },
  {
    id: 7,
    name: "Aurora",
  },
  {
    id: 8,
    name: "Vanchiglia",
  },
  {
    id: 9,
    name: "Nizza millefonti",
  },
  {
    id: 10,
    name: "Mercati generali",
  },
  {
    id: 11,
    name: "Santa Rita",
  },
  {
    id: 12,
    name: "Mirafiori Nord",
  },
  {
    id: 13,
    name: "Pozzo Strada",
  },
  {
    id: 14,
    name: "Parella",
  },
  {
    id: 15,
    name: "Le Vallette",
  },
  {
    id: 16,
    name: "Madonna di Campagna",
  },
  {
    id: 17,
    name: "Borgata Vittoria",
  },
  {
    id: 18,
    name: "Barriera di Milano",
  },
  {
    id: 19,
    name: "Falchera",
  },
  {
    id: 20,
    name: "Regio Parco",
  },
  {
    id: 21,
    name: "Madonna del Pilone",
  },
  {
    id: 22,
    name: "Borgo Po e Cavoretto",
  },
  {
    id: 23,
    name: "Mirafiori Sud",
  },
] as const;
export const GEOGRAPHY_SOURCE = {
  idField: "IDQUART",
  sourceField: "num_quartiere",
  sourceFile: "data/raw/popolazione_quartieri_2025.csv",
  sha256: "044a7b759889ab6108ac2296b07943a9b9a8f97da9f98514017ce714c1973f4c",
  pointAssignments: "fixed_demo_without_coordinates",
} as const;
export const FIXED_POINTS = [
  {
    id: "1",
    name: "Macchinetta Aurora",
    kind: 0,
    zoneId: 7,
    neighborhoodId: 7,
    operatorSlot: 0,
  },
  {
    id: "2",
    name: "Macchinetta Santa Rita",
    kind: 0,
    zoneId: 2,
    neighborhoodId: 11,
    operatorSlot: 1,
  },
  {
    id: "3",
    name: "Market Aurora",
    kind: 1,
    zoneId: 7,
    neighborhoodId: 7,
    operatorSlot: 2,
  },
  {
    id: "4",
    name: "Market Santa Rita",
    kind: 1,
    zoneId: 2,
    neighborhoodId: 11,
    operatorSlot: 3,
  },
  {
    id: "5",
    name: "Macchinetta Centro",
    kind: 0,
    zoneId: 1,
    neighborhoodId: 1,
    operatorSlot: 0,
  },
  {
    id: "6",
    name: "Macchinetta San Salvario",
    kind: 0,
    zoneId: 8,
    neighborhoodId: 2,
    operatorSlot: 1,
  },
  {
    id: "7",
    name: "Macchinetta San Paolo",
    kind: 0,
    zoneId: 3,
    neighborhoodId: 4,
    operatorSlot: 0,
  },
  {
    id: "8",
    name: "Macchinetta San Donato",
    kind: 0,
    zoneId: 4,
    neighborhoodId: 6,
    operatorSlot: 1,
  },
  {
    id: "9",
    name: "Macchinetta Parella",
    kind: 0,
    zoneId: 4,
    neighborhoodId: 14,
    operatorSlot: 0,
  },
  {
    id: "10",
    name: "Macchinetta Madonna di Campagna",
    kind: 0,
    zoneId: 5,
    neighborhoodId: 16,
    operatorSlot: 1,
  },
  {
    id: "11",
    name: "Macchinetta Barriera di Milano",
    kind: 0,
    zoneId: 6,
    neighborhoodId: 18,
    operatorSlot: 0,
  },
  {
    id: "12",
    name: "Macchinetta Mirafiori Sud",
    kind: 0,
    zoneId: 2,
    neighborhoodId: 23,
    operatorSlot: 1,
  },
  {
    id: "13",
    name: "Market Centro",
    kind: 1,
    zoneId: 1,
    neighborhoodId: 1,
    operatorSlot: 4,
  },
  {
    id: "14",
    name: "Market San Salvario",
    kind: 1,
    zoneId: 8,
    neighborhoodId: 2,
    operatorSlot: 5,
  },
  {
    id: "15",
    name: "Market Madonna di Campagna",
    kind: 1,
    zoneId: 5,
    neighborhoodId: 16,
    operatorSlot: 6,
  },
  {
    id: "16",
    name: "Market Barriera di Milano",
    kind: 1,
    zoneId: 6,
    neighborhoodId: 18,
    operatorSlot: 7,
  },
] as const;
export function neighborhoodName(id: number): string {
  const area = NEIGHBORHOODS.find((area) => area.id === id);
  if (!area) throw new Error(`Quartiere sconosciuto: ${id}`);
  return area.name;
}
