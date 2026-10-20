// Championship standings before a race, from the free Jolpica API (the Ergast successor).
import type { Standings } from "./types";

const JOLPICA = "https://api.jolpi.ca/ergast/f1";

interface JolpicaRace {
  round: string;
  date: string;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Jolpica ${res.status}`);
  return res.json();
}

/**
 * Standings after the round before the race held on `raceDate` (YYYY-MM-DD).
 * Resolves null if the race is not in the calendar or the API is unreachable.
 */
export async function standingsBefore(year: number, raceDate: string): Promise<Standings | null> {
  try {
    const cal = await getJson(`${JOLPICA}/${year}.json?limit=100`);
    const races: JolpicaRace[] = cal?.MRData?.RaceTable?.Races ?? [];
    const race = races.find((r) => r.date === raceDate);
    if (!race) return null;
    const round = Number(race.round);
    if (round <= 1) return { drivers: [], constructors: [] };
    const [d, c] = await Promise.all([
      getJson(`${JOLPICA}/${year}/${round - 1}/driverStandings.json?limit=100`),
      getJson(`${JOLPICA}/${year}/${round - 1}/constructorStandings.json?limit=100`),
    ]);
    const dl = d?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings ?? [];
    const cl = c?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings ?? [];
    return {
      drivers: dl.map((x: any) => ({
        number: x.Driver?.permanentNumber != null ? Number(x.Driver.permanentNumber) : null,
        code: x.Driver?.code ?? null,
        points: Number(x.points) || 0,
      })),
      constructors: cl.map((x: any) => ({ team: String(x.Constructor?.name ?? "--"), points: Number(x.points) || 0 })),
    };
  } catch {
    return null;
  }
}
