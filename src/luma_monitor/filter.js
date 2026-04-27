const AI_TERMS = [
  "ai",
  "artificial intelligence",
  "machine learning",
  "ml",
  "llm",
  "genai",
  "generative ai",
  "agent",
  "agents"
];

const TECH_TERMS = [
  "data",
  "startup",
  "founder",
  "software",
  "developer",
  "engineering",
  "tech",
  "robotics"
];

const NON_TARGET_CITY_TERMS = [
  "san francisco",
  "new york",
  "los angeles",
  "austin",
  "boston",
  "chicago",
  "miami",
  "portland",
  "denver",
  "atlanta"
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTerm(text, term) {
  const escaped = escapeRegExp(term.toLowerCase());
  if (/^[a-z0-9]+$/i.test(term)) {
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  }
  return text.includes(term.toLowerCase());
}

function matchedTerms(text, terms) {
  return terms.filter((term) => hasTerm(text, term));
}

export function buildSearchText(event) {
  return [
    event.title,
    event.dateText,
    event.locationText,
    event.hostText,
    event.statusText,
    event.descriptionText,
    event.cardText,
    event.detailText,
    event.sourceName,
    event.sourceUrl
  ].filter(Boolean).join("\n").toLowerCase();
}

export function scoreEvent(event, config) {
  const text = buildSearchText(event);
  const nearbyTerms = config.location?.nearby_terms || [];
  const targetCity = config.location?.target_city || "";
  const includeTerms = config.relevance?.include_terms || [];
  const excludeTerms = config.relevance?.exclude_terms || [];
  const configuredAiTerms = includeTerms.filter((term) => AI_TERMS.includes(term.toLowerCase()));
  const configuredTechTerms = includeTerms.filter((term) => TECH_TERMS.includes(term.toLowerCase()));
  const aiTerms = configuredAiTerms.length ? configuredAiTerms : AI_TERMS;
  const techTerms = configuredTechTerms.length ? configuredTechTerms : TECH_TERMS;

  const nearbyMatches = matchedTerms(text, nearbyTerms);
  const aiMatches = matchedTerms(text, aiTerms);
  const techMatches = matchedTerms(text, techTerms);
  const excludeMatches = matchedTerms(text, excludeTerms);
  const nonTargetCityMatches = matchedTerms(text, NON_TARGET_CITY_TERMS)
    .filter((term) => term.toLowerCase() !== targetCity.toLowerCase());

  let score = 0;
  if (nearbyMatches.length > 0) score += 3;
  if (aiMatches.length > 0) score += 2;
  if (techMatches.length > 0) score += 1;
  if (excludeMatches.length > 0) score -= 2 * excludeMatches.length;

  const sourceUrl = (event.sourceUrl || "").toLowerCase();
  const sourceLooksRelevant = sourceUrl.includes("/ai") || sourceUrl.includes("/tech");
  const sourceLooksTargetCity = targetCity && sourceUrl.includes(`/${targetCity.toLowerCase().replace(/\s+/g, "-")}`);
  const hasNearbySignal = nearbyMatches.length > 0
    || sourceLooksTargetCity
    || (event.foundInNearbySection && nonTargetCityMatches.length === 0);

  if (sourceLooksRelevant && event.foundInNearbySection && excludeMatches.length === 0) {
    score = Math.max(score, 2);
  }

  const reasons = [];
  if (nearbyMatches.length) reasons.push(`Seattle-area: ${nearbyMatches.slice(0, 3).join(", ")}`);
  if (sourceLooksTargetCity) reasons.push(`source city: ${targetCity}`);
  if (aiMatches.length) reasons.push(`AI: ${aiMatches.slice(0, 3).join(", ")}`);
  if (techMatches.length) reasons.push(`Tech: ${techMatches.slice(0, 3).join(", ")}`);
  if (event.foundInNearbySection) reasons.push("visible in nearby section");
  if (!hasNearbySignal) reasons.push("no nearby signal");
  if (nonTargetCityMatches.length && nearbyMatches.length === 0) {
    reasons.push(`other city signal: ${nonTargetCityMatches.slice(0, 3).join(", ")}`);
  }
  if (excludeMatches.length) reasons.push(`Excluded terms: ${excludeMatches.slice(0, 3).join(", ")}`);
  if (!reasons.length) reasons.push("no configured terms matched");

  return {
    keep: hasNearbySignal && score >= 2,
    score,
    reasons,
    why: reasons.join("; ")
  };
}
