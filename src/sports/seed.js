/**
 * Placeholder seed data so the app works out of the box with no API key.
 * Groups/fixtures are illustrative — run Admin → "Sync matches" to pull real
 * data from the configured sports provider.
 */
const TEAMS = [
  { name: 'Mexico', code: 'MEX', flag: '🇲🇽', groupName: 'A' },
  { name: 'South Korea', code: 'KOR', flag: '🇰🇷', groupName: 'A' },
  { name: 'South Africa', code: 'RSA', flag: '🇿🇦', groupName: 'A' },
  { name: 'Denmark', code: 'DEN', flag: '🇩🇰', groupName: 'A' },
  { name: 'Canada', code: 'CAN', flag: '🇨🇦', groupName: 'B' },
  { name: 'Italy', code: 'ITA', flag: '🇮🇹', groupName: 'B' },
  { name: 'Qatar', code: 'QAT', flag: '🇶🇦', groupName: 'B' },
  { name: 'Switzerland', code: 'SUI', flag: '🇨🇭', groupName: 'B' },
  { name: 'Brazil', code: 'BRA', flag: '🇧🇷', groupName: 'C' },
  { name: 'Morocco', code: 'MAR', flag: '🇲🇦', groupName: 'C' },
  { name: 'Scotland', code: 'SCO', flag: '🏴󠁧󠁢󠁳󠁣󠁴󠁿', groupName: 'C' },
  { name: 'Haiti', code: 'HAI', flag: '🇭🇹', groupName: 'C' },
  { name: 'USA', code: 'USA', flag: '🇺🇸', groupName: 'D' },
  { name: 'Australia', code: 'AUS', flag: '🇦🇺', groupName: 'D' },
  { name: 'Paraguay', code: 'PAR', flag: '🇵🇾', groupName: 'D' },
  { name: 'Czechia', code: 'CZE', flag: '🇨🇿', groupName: 'D' },
  { name: 'Argentina', code: 'ARG', flag: '🇦🇷', groupName: 'E' },
  { name: 'Algeria', code: 'ALG', flag: '🇩🇿', groupName: 'E' },
  { name: 'Austria', code: 'AUT', flag: '🇦🇹', groupName: 'E' },
  { name: 'Jordan', code: 'JOR', flag: '🇯🇴', groupName: 'E' },
  { name: 'Netherlands', code: 'NED', flag: '🇳🇱', groupName: 'F' },
  { name: 'Japan', code: 'JPN', flag: '🇯🇵', groupName: 'F' },
  { name: 'Tunisia', code: 'TUN', flag: '🇹🇳', groupName: 'F' },
  { name: 'New Zealand', code: 'NZL', flag: '🇳🇿', groupName: 'F' },
  { name: 'Belgium', code: 'BEL', flag: '🇧🇪', groupName: 'G' },
  { name: 'Egypt', code: 'EGY', flag: '🇪🇬', groupName: 'G' },
  { name: 'Iran', code: 'IRN', flag: '🇮🇷', groupName: 'G' },
  { name: 'Panama', code: 'PAN', flag: '🇵🇦', groupName: 'G' },
  { name: 'Spain', code: 'ESP', flag: '🇪🇸', groupName: 'H' },
  { name: 'Uruguay', code: 'URU', flag: '🇺🇾', groupName: 'H' },
  { name: 'Saudi Arabia', code: 'KSA', flag: '🇸🇦', groupName: 'H' },
  { name: 'Cape Verde', code: 'CPV', flag: '🇨🇻', groupName: 'H' },
  { name: 'France', code: 'FRA', flag: '🇫🇷', groupName: 'I' },
  { name: 'Senegal', code: 'SEN', flag: '🇸🇳', groupName: 'I' },
  { name: 'Norway', code: 'NOR', flag: '🇳🇴', groupName: 'I' },
  { name: 'Uzbekistan', code: 'UZB', flag: '🇺🇿', groupName: 'I' },
  { name: 'Portugal', code: 'POR', flag: '🇵🇹', groupName: 'J' },
  { name: 'Colombia', code: 'COL', flag: '🇨🇴', groupName: 'J' },
  { name: 'Ghana', code: 'GHA', flag: '🇬🇭', groupName: 'J' },
  { name: 'Curaçao', code: 'CUW', flag: '🇨🇼', groupName: 'J' },
  { name: 'England', code: 'ENG', flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', groupName: 'K' },
  { name: 'Croatia', code: 'CRO', flag: '🇭🇷', groupName: 'K' },
  { name: 'Ecuador', code: 'ECU', flag: '🇪🇨', groupName: 'K' },
  { name: 'Ivory Coast', code: 'CIV', flag: '🇨🇮', groupName: 'K' },
  { name: 'Germany', code: 'GER', flag: '🇩🇪', groupName: 'L' },
  { name: 'Nigeria', code: 'NGA', flag: '🇳🇬', groupName: 'L' },
  { name: 'Greece', code: 'GRE', flag: '🇬🇷', groupName: 'L' },
  { name: 'Cuba', code: 'CUB', flag: '🇨🇺', groupName: 'L' },
];

// Sample fixtures relative to "today" so demo always has today's matches.
// All seeded matches are upcoming with no scores — scores only appear once a
// match actually goes live (via the provider sync or admin result entry).
function buildFixtures(now = new Date()) {
  const day = (offset, h, m = 0) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  return [
    { extId: 'seed-1', a: 'Mexico', b: 'South Africa', kickoff: day(0, 21), group: 'A', status: 'upcoming' },
    { extId: 'seed-2', a: 'South Korea', b: 'Denmark', kickoff: day(0, 18), group: 'A', status: 'upcoming' },
    { extId: 'seed-3', a: 'Canada', b: 'Qatar', kickoff: day(1, 13), group: 'B', status: 'upcoming' },
    { extId: 'seed-4', a: 'Italy', b: 'Switzerland', kickoff: day(1, 16), group: 'B', status: 'upcoming' },
    { extId: 'seed-5', a: 'USA', b: 'Paraguay', kickoff: day(1, 19), group: 'D', status: 'upcoming' },
    { extId: 'seed-6', a: 'Brazil', b: 'Haiti', kickoff: day(2, 13), group: 'C', status: 'upcoming' },
    { extId: 'seed-7', a: 'Morocco', b: 'Scotland', kickoff: day(2, 16), group: 'C', status: 'upcoming' },
    { extId: 'seed-8', a: 'Argentina', b: 'Jordan', kickoff: day(2, 19), group: 'E', status: 'upcoming' },
    { extId: 'seed-9', a: 'Australia', b: 'Czechia', kickoff: day(2, 22), group: 'D', status: 'upcoming' },
    { extId: 'seed-10', a: 'Netherlands', b: 'New Zealand', kickoff: day(3, 13), group: 'F', status: 'upcoming' },
    { extId: 'seed-11', a: 'Spain', b: 'Cape Verde', kickoff: day(3, 16), group: 'H', status: 'upcoming' },
    { extId: 'seed-12', a: 'France', b: 'Uzbekistan', kickoff: day(3, 19), group: 'I', status: 'upcoming' },
    { extId: 'seed-13', a: 'England', b: 'Ecuador', kickoff: day(4, 13), group: 'K', status: 'upcoming' },
    { extId: 'seed-14', a: 'Germany', b: 'Cuba', kickoff: day(4, 16), group: 'L', status: 'upcoming' },
    { extId: 'seed-15', a: 'Portugal', b: 'Curaçao', kickoff: day(4, 19), group: 'J', status: 'upcoming' },
  ].map(f => ({
    extId: f.extId,
    teamAName: f.a,
    teamBName: f.b,
    kickoff: f.kickoff,
    stage: 'Group Stage',
    groupName: f.group,
    status: f.status,
    scoreA: f.sa ?? null,
    scoreB: f.sb ?? null,
  }));
}

module.exports = { TEAMS, buildFixtures };
