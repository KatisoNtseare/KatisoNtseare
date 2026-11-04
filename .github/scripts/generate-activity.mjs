const token = process.env.GITHUB_TOKEN;
const username = process.env.GITHUB_REPOSITORY_OWNER || process.env.GITHUB_ACTOR;

if (!token || !username) {
  throw new Error("GITHUB_TOKEN and GitHub username are required.");
}

const to = new Date();
const from = new Date(to);
from.setUTCDate(from.getUTCDate() - 364);

const query = `
  query ContributionActivity($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }
`;

const response = await fetch("https://api.github.com/graphql", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "profile-activity-generator"
  },
  body: JSON.stringify({
    query,
    variables: {
      login: username,
      from: from.toISOString(),
      to: to.toISOString()
    }
  })
});

if (!response.ok) {
  throw new Error(`GitHub GraphQL returned HTTP ${response.status}: ${await response.text()}`);
}

const payload = await response.json();

if (payload.errors?.length) {
  throw new Error(payload.errors.map(error => error.message).join("; "));
}

const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;

if (!calendar?.weeks?.length) {
  throw new Error("GitHub did not return contribution calendar data.");
}

const weekly = calendar.weeks.map(week => ({
  date: week.contributionDays[0]?.date,
  count: week.contributionDays.reduce((sum, day) => sum + day.contributionCount, 0)
})).filter(week => week.date);

if (!weekly.length) {
  throw new Error("Contribution calendar contains no weekly data.");
}

const width = 1000;
const height = 300;
const left = 68;
const right = 32;
const top = 58;
const bottom = 48;
const plotWidth = width - left - right;
const plotHeight = height - top - bottom;
const baseline = top + plotHeight;
const maxValue = Math.max(4, ...weekly.map(week => week.count));
const yMax = Math.ceil(maxValue / 5) * 5;
const x = index => left + (weekly.length === 1 ? 0 : index * plotWidth / (weekly.length - 1));
const y = value => baseline - (value / yMax) * plotHeight;
const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;"
})[char]);

const points = weekly.map((week, index) => [x(index), y(week.count)]);
const linePath = points.map((point, index) =>
  `${index === 0 ? "M" : "L"} ${point[0].toFixed(2)} ${point[1].toFixed(2)}`
).join(" ");
const areaPath = `${linePath} L ${points.at(-1)[0].toFixed(2)} ${baseline} L ${points[0][0].toFixed(2)} ${baseline} Z`;

const grid = Array.from({ length: 5 }, (_, index) => {
  const value = yMax * index / 4;
  const position = y(value);
  return `
    <line x1="${left}" y1="${position}" x2="${width - right}" y2="${position}" stroke="#30363d" stroke-width="1" />
    <text x="${left - 14}" y="${position + 4}" fill="#8b949e" font-size="11" text-anchor="end">${Math.round(value)}</text>
  `;
}).join("");

let previousMonth = -1;
const monthLabels = weekly.map((week, index) => {
  const date = new Date(`${week.date}T00:00:00Z`);
  const month = date.getUTCMonth();
  if (month === previousMonth) return "";
  previousMonth = month;
  return `<text x="${x(index)}" y="${height - 17}" fill="#8b949e" font-size="11">${date.toLocaleString("en", { month: "short", timeZone: "UTC" })}</text>`;
}).join("");

const circles = weekly.map((week, index) => `
  <circle cx="${x(index).toFixed(2)}" cy="${y(week.count).toFixed(2)}" r="2.5" fill="#58a6ff">
    <title>Week of ${escapeXml(week.date)}: ${week.count} contributions</title>
  </circle>
`).join("");

const firstDate = weekly[0].date;
const lastDate = weekly.at(-1).date;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)}'s GitHub contribution activity</title>
  <desc id="desc">${calendar.totalContributions} public contributions from ${firstDate} to ${lastDate}, shown as weekly activity.</desc>
  <defs>
    <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#58a6ff" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#58a6ff" stop-opacity="0.02" />
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" rx="12" fill="#0d1117" />
  <text x="${left}" y="29" fill="#f0f6fc" font-size="16" font-weight="600">Contribution activity</text>
  <text x="${width - right}" y="29" fill="#8b949e" font-size="12" text-anchor="end">${calendar.totalContributions.toLocaleString("en-US")} contributions · last 12 months</text>
  ${grid}
  <path d="${areaPath}" fill="url(#area)" />
  <path d="${linePath}" fill="none" stroke="#58a6ff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
  ${circles}
  ${monthLabels}
</svg>
`;

await import("node:fs/promises").then(fs => fs.writeFile("profile/activity.svg", svg, "utf8"));
console.log(`Generated activity graph with ${weekly.length} weeks and ${calendar.totalContributions} contributions.`);
