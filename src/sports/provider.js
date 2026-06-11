/**
 * SportsProvider interface.
 *
 * Every provider must implement:
 *   name: string
 *   fetchTeams(): Promise<Array<{ extId, name, code, flag, groupName }>>
 *   fetchFixtures(): Promise<Array<{
 *     extId, teamAName, teamBName, kickoff (ISO string, UTC),
 *     stage, groupName, status ('upcoming'|'live'|'finished'),
 *     scoreA (int|null), scoreB (int|null)
 *   }>>
 *
 * Swap providers via SPORTS_PROVIDER env var. Adding a new provider = one file
 * implementing the contract above + one entry in the registry below.
 */

function getProvider() {
  const name = (process.env.SPORTS_PROVIDER || 'espn').toLowerCase();
  switch (name) {
    case 'espn':
      return require('./espn');
    case 'thesportsdb':
      return require('./thesportsdb');
    default:
      throw new Error(`Unknown SPORTS_PROVIDER: ${name}`);
  }
}

module.exports = { getProvider };
