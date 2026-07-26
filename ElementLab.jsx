// src/Pages/ElementGame.jsx
//
// ELEMENT GAME — v1 merged build
// ────────────────────────────────────────────────────────────────────────
// This replaces the three-way split between ElementLab (crypto tutorial),
// ElementArena (bot economy), and ElementOrigins (fusion/Life race). It's
// one game now:
//
//   Every action — mining, staking, swapping, providing liquidity, voting,
//   igniting a star — spends one turn. Turn order is reshuffled every
//   round, so sometimes you act before the bots, sometimes after — you
//   genuinely can get front-run without any extra mechanic needed for it.
//   Everyone (you + 3 bots) starts with the same $5. No one starts richer.
//
//   Your wallet is spendable and can go up or down. Your LIFETIME MASS only
//   ever goes up — every dollar you actually earn (selling tokens, staking
//   rewards, LP payouts) adds to it permanently, even after you spend it.
//   Lifetime mass — not your current wallet — decides what class of star
//   you get when you ignite. A bad trade right before igniting can't shrink
//   your star.
//
//   Ignite → ​the star fuses on its own clock (He→C→O→Ne→Mg→Si→Fe). Small
//   stars stall out before Iron — that's not a bug, it's the lesson, and a
//   stalled star isn't wasted (see governance, below). Reach Iron, trigger
//   the supernova yourself, and its output is what lets you craft Water,
//   a Planet, and finally Life. First run ends there: no second market
//   exists yet, just the taste of the finish line.
//
// TOKENOMICS CONCEPTS ARE THE GATES, NOT A CHECKLIST ON TOP OF THEM:
//   - Water requires H + O *and* a real lifetime Fluorine-burn threshold —
//     you cannot synthesize it without having actually destroyed some
//     supply yourself. Burning isn't decorative anymore; it's the key.
//   - Planet requires the fused materials AND a real-time LOCK (same
//     tradeoff as any staking lockup) — begin the lock, wait it out, or
//     break it early for a partial refund. There's no instant "combine."
//   - Life requires the crafted materials AND a passed governance vote
//     ("ratify abiogenesis"). The NPC bloc is deliberately unfavorable —
//     the Treasury alone votes no, and passing needs real weight: your
//     Beryllium plus 3x every star you've had stall. A dead star is
//     political capital, not a loss.
//   - Alloy staking pays ONLY from real trading-fee revenue (yours or a
//     bot's) — no flat trickle. Lithium's mining buff, by contrast, always
//     fires regardless of market activity. That contrast (inflationary
//     yield vs. real yield) is deliberately left to be felt, not labeled.
//
// v1 SCOPE CUTS (intentional, documented so the next pass knows what's
// deferred and why):
//   - Bots only ever extract, swap, or toggle the Lithium buff. Liquidity
//     providing, governance, Alloy staking, and the whole fusion race are
//     human-only for now — giving bots the full action space is a much
//     bigger AI problem and isn't needed to prove the core loop.
//   - Bots don't run their own star. They're market participants you're
//     out-earning, not opponents in the Life race. Racing bots are a
//     natural v2 addition once this loop is validated.
//   - Dead-star governance weight is scoped to the single human player.
//     Pooling dead-star weight across real players in a shared vote is the
//     obvious multiplayer extension, not built here.
//   - "Lifetime mass increases on any USD received" is a deliberate
//     simplification — removing liquidity counts the whole withdrawal, not
//     just the profit over principal. Good enough for v1, worth revisiting
//     once real wash-trading exploits start to matter.
//   - Burning fluorine only unlocks Water in this pass, not a whole second
//     tradable market for the fusion elements — that's the natural v2.
//   - No persistence. This runs in memory only for this session (artifacts
//     can't use localStorage/sessionStorage) — wire it to whatever storage
//     your app actually uses when this gets pulled into the real project.
//
// Every new mechanic still follows the original design doc's rules: plain
// normalized state shapes, pure functions for the math, ticked (not
// instant) rewards wherever the whitepaper specifies a reward index.
//
// ── v2 ADDITIONS ────────────────────────────────────────────────────────
//   - EVERYTHING THAT USED TO BE WALL-CLOCK IS NOW TURN-BASED. Planet
//     accretion, fusion stage advancement, and the Period 1 bonus window
//     all used to run on setTimeout/Date.now(). They now advance once per
//     turn taken — by anyone, human or bot — via the tick* functions
//     called from advanceTurn(). There is no more `now`/setInterval clock
//     anywhere in this file. (BOT_TURN_DELAY_MS is the one exception: it's
//     a pure UI pacing delay so a bot's move is readable before the next
//     turn resolves — it doesn't gate any mechanic's completion, so it
//     isn't part of "nothing on a timer.")
//   - Deuterium staking: a FIXED-APR contract, deliberately the opposite
//     of Genesis Alloy staking. Stake D, wait a fixed number of turns
//     (one "epoch"), get exactly 10% back — guaranteed, whether or not
//     anyone traded. Sits right next to Alloy staking so the contrast
//     (guaranteed inflationary yield vs. real fee-based yield) is felt
//     directly, the same way Lithium's buff already contrasts with it.
//   - Two-sided liquidity farming: a genuinely new pair type — token/token,
//     not token/USD. Depositing both sides of Lithium/Beryllium earns a
//     reward token (Photon) every turn, proportional to your share of the
//     pool — an emission, not a cut of swap fees. Toggle auto-compound and
//     half of every reward buys back into the pool automatically (shares
//     grow over time); leave it off and rewards just accumulate to cash
//     out by hand. A second farm (Silicon/Iron, reward token Ash) unlocks
//     post-supernova, so the same lesson lands twice in a different
//     material context. v1 SIMPLIFICATION: reward tokens (Photon, Ash)
//     aren't given their own swap market — claiming converts them to USD
//     at a fixed rate (FARM_REWARD_USD_VALUE), and compounding mints new
//     LP shares directly from the reward amount (FARM_COMPOUND_SHARE_RATE)
//     rather than routing through a real two-step sell-then-deposit. Both
//     are placeholders for when reward tokens get real pools of their own.

import React, { useEffect, useMemo, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────
const FEE_BPS = 30; // 0.3% swap fee, constant-product AMM
const FLUORINE_BURN_RATE = 0.05; // 5% destroyed on every Fluorine sale
const STARTING_USD = 5; // everyone's buy-in — human and every bot, equal

const GENESIS_COST = { hydrogen: 5, helium: 2 };
const PROPOSAL_COST = 2; // beryllium required to submit a governance proposal

// Turns, not seconds — long enough to feel like a real commitment (a
// couple of full rounds), short enough that a single play session clears
// it comfortably.
const PERIOD1_BONUS_TURNS = 12;
const PERIOD1_BONUS_MULT = 1.5;

const HELIUM_CHANCE = 0.35;
const LITHIUM_DROP_CHANCE = 0.12;
const BERYLLIUM_DROP_CHANCE = 0.18;
const LITHIUM_BUFF_MULT = 1.5;

const BOT_TURN_DELAY_MS = 950;   // pause so a bot's action is readable before advancing

// Burning is the unlock, not a checkbox: Water can't be synthesized until
// you've actually destroyed some Fluorine yourself (a couple of real sales'
// worth). Only the human's own burning counts toward this.
const FLUORINE_BURN_UNLOCK = 0.1;

// Staking is the unlock for Planet, not an optional side activity: forming
// one requires locking the fused materials for a number of turns, same
// tradeoff a real staking lockup has. Breaking the lock early returns only
// a fraction. 8 turns is about two full rounds — noticeable, not tedious.
const PLANET_LOCK_TURNS = 8;
const PLANET_LOCK_BREAK_RETURN = 0.5;

// Governance decides whether Life can be created at all. A stalled star
// isn't wasted — every one adds voting weight, same as the design docs'
// idea of dead-star weight mattering politically.
const DEAD_STAR_VOTE_WEIGHT = 3;

// ── Ignition & fusion ───────────────────────────────────────────────────
const IGNITE_COST = 2; // flat USD, same price regardless of class
const MASS_TIERS = { sunLike: 15, supergiant: 40 }; // lifetime-mass thresholds

const FUSION_STAGES = ["helium", "carbon", "oxygen", "neon", "magnesium", "silicon", "iron"];
const STAGE_YIELD    = { helium: 4, carbon: 3, oxygen: 3, neon: 2, magnesium: 2, silicon: 2, iron: 1 };

// turnsPerStage replaces the old wall-clock tickMs: bigger stars still
// fuse faster (fewer turns per stage), it's just paced by turns taken —
// by anyone — instead of a real-time interval.
const CLASS_CONFIG = {
  redDwarf:   { label: "Red Dwarf",  icon: "🔴", maxStageIndex: 2, turnsPerStage: 5 }, // stalls after Oxygen
  sunLike:    { label: "Sun-like",   icon: "🟡", maxStageIndex: 4, turnsPerStage: 4, breakthroughChance: 0.25 }, // caps at Magnesium, chance to punch through to Iron
  supergiant: { label: "Supergiant", icon: "🔵", maxStageIndex: 6, turnsPerStage: 3 }, // reaches Iron
};

function classify(lifetimeMass) {
  if (lifetimeMass >= MASS_TIERS.supergiant) return "supergiant";
  if (lifetimeMass >= MASS_TIERS.sunLike) return "sunLike";
  return "redDwarf";
}

// ── Deuterium: fixed-APR staking ────────────────────────────────────────
// The deliberate opposite of Genesis Alloy staking. Stake D, wait one full
// epoch (a fixed number of turns), and get exactly 10% back — guaranteed,
// whether the market moved at all. No trade volume required, no variance.
const DEUTERIUM_APR = 0.10; // 10% of staked principal, per epoch
const DEUTERIUM_EPOCH_TURNS = 8; // turns per epoch — matches the Planet lock's weight

// ── Two-sided liquidity farming ─────────────────────────────────────────
// A genuinely different pair type from the existing token/USD pools:
// deposit BOTH sides of a market (like real LUNC/USTC farming) and earn a
// third, distinct reward token every turn — an emission proportional to
// your share, not a cut of swap fees. Auto-compound reinvests half of
// every reward back into the pool automatically; leave it off and rewards
// just pile up to cash out by hand. Two pairs exist: Lithium/Beryllium is
// available from the start, Silicon/Iron unlocks after your first
// supernova, so the same lesson lands twice in a different material
// context.
const PHOTON_PER_TURN_PER_SHARE = 0.002; // Li/Be farm emission rate
const ASH_PER_TURN_PER_SHARE = 0.003;    // Si/Fe farm emission rate (rarer inputs, richer reward)
const FARM_COMPOUND_SPLIT = 0.5;         // fraction of each reward that auto-compounds vs. cashes out
const FARM_COMPOUND_SHARE_RATE = 10;     // v1 simplification: compounded reward → new LP shares, 1:10
const FARM_REWARD_USD_VALUE = 0.5;       // v1 simplification: 1 reward token cashes out at a fixed $0.50

const FARM_PAIRS = {
  libe: { tokenA: "lithium", tokenB: "beryllium", rewardKey: "photon", label: "Lithium–Beryllium Farm", ratePerShare: PHOTON_PER_TURN_PER_SHARE, requiresSupernova: false },
  siFe: { tokenA: "silicon", tokenB: "iron", rewardKey: "ash", label: "Silicon–Iron Farm", ratePerShare: ASH_PER_TURN_PER_SHARE, requiresSupernova: true },
};

function freshFarmPools() {
  return {
    libe: { reserveA: 20, reserveB: 12, totalShares: 1000 },
    siFe: { reserveA: 10, reserveB: 6, totalShares: 1000 },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Element / resource metadata
// ─────────────────────────────────────────────────────────────────────────
const RESOURCES = {
  hydrogen:  { label: "Hydrogen",   symbol: "H",  icon: "⚛️", color: "#6cc4ff" },
  helium:    { label: "Helium",     symbol: "He", icon: "🎈", color: "#ffd76c" },
  lithium:   { label: "Lithium",    symbol: "Li", icon: "🔋", color: "#c98cff" },
  fluorine:  { label: "Fluorine",   symbol: "F",  icon: "🧪", color: "#ff9d6c" },
  beryllium: { label: "Beryllium",  symbol: "Be", icon: "🗝️", color: "#7dffb0" },
  carbon:    { label: "Carbon",     symbol: "C",  icon: "⚫" },
  oxygen:    { label: "Oxygen",     symbol: "O",  icon: "💧" },
  neon:      { label: "Neon",       symbol: "Ne", icon: "✨" },
  magnesium: { label: "Magnesium",  symbol: "Mg", icon: "🔥" },
  silicon:   { label: "Silicon",    symbol: "Si", icon: "🔷" },
  iron:      { label: "Iron",       symbol: "Fe", icon: "⚙️" },
  nitrogen:  { label: "Nitrogen",   symbol: "N",  icon: "💨" },
  phosphorus:{ label: "Phosphorus", symbol: "P",  icon: "🌱" },
  sulfur:    { label: "Sulfur",     symbol: "S",  icon: "🌕" },
  deuterium: { label: "Deuterium",  symbol: "D",  icon: "🧊", color: "#7dc9ff" },
  photon:    { label: "Photon",     symbol: "γ",  icon: "💫" },
  ash:       { label: "Stellar Ash",symbol: "Ash", icon: "🌫️" },
};
const POOL_KEYS = ["hydrogen", "helium", "lithium", "fluorine", "beryllium", "deuterium"];
const ALL_ELEMENT_KEYS = [...POOL_KEYS, "carbon", "oxygen", "neon", "magnesium", "silicon", "iron", "nitrogen", "phosphorus", "sulfur", "photon", "ash"];

function freshElementBalances() {
  return Object.fromEntries(ALL_ELEMENT_KEYS.map(k => [k, 0]));
}

// Small, shallow pools on purpose — with a $5 buy-in, a $1-3 trade should
// visibly move the price. Ratios preserve the original Lab's spot prices.
function freshPools() {
  return {
    hydrogen:  { usd: 40, token: 80,  priceHistory: [0.5], lpTotalShares: 1000 },
    helium:    { usd: 30, token: 5,   priceHistory: [6],   lpTotalShares: 1000 },
    lithium:   { usd: 20, token: 5,   priceHistory: [4],   lpTotalShares: 1000 },
    fluorine:  { usd: 24, token: 12,  priceHistory: [2],   lpTotalShares: 1000 },
    beryllium: { usd: 30, token: 2.5, priceHistory: [12],  lpTotalShares: 1000 },
    deuterium: { usd: 26, token: 10,  priceHistory: [2.6], lpTotalShares: 1000 },
  };
}

const FEE_SPLIT = { lp: 0.17 / 0.30, staker: 0.05 / 0.30, treasury: 0.05 / 0.30, burn: 0.03 / 0.30 };

// Deliberately unbalanced toward "no": the Treasury alone is skeptical
// enough that a proposer needs real weight — beryllium plus dead-star
// weight — to tip this. Without you, yes = 7 of 17 (41%) — it fails on its
// own. (Do the algebra before changing these: with the human always voting
// yes, passing requires playerWeight > 3.)
const NPC_HOLDERS = [
  { name: "Treasury Multisig", be: 10, vote: "no" },
  { name: "Early Backer Wallet", be: 5, vote: "yes" },
  { name: "Community Member", be: 2, vote: "yes" },
];

const BOT_ARCHETYPES = {
  alkali:  { name: "Alkali",  icon: "⚡", desc: "Trades almost every turn, chases whatever's moving." },
  noble:   { name: "Noble",   icon: "🧊", desc: "Mostly mines quietly, rarely trades." },
  halogen: { name: "Halogen", icon: "🧪", desc: "Quiet, then periodically dumps a big chunk of one holding." },
};
const BOT_ROSTER = [
  { id: "bot-alkali",  name: "Quick Nova",  archetype: "alkali" },
  { id: "bot-noble",   name: "Steady Rae",  archetype: "noble" },
  { id: "bot-halogen", name: "Corro",       archetype: "halogen" },
];

// ─────────────────────────────────────────────────────────────────────────
// Tutorial script — Solo Tutorial Mode. Spotlights real UI (no separate
// fake walkthrough) and, where a mechanic has a felt lesson, requires the
// player to actually do it before moving on. During tutorial mode the
// human always goes first each round (no shuffle) so nothing here is
// gated behind luck — see the round-order logic in advanceTurn().
// ─────────────────────────────────────────────────────────────────────────
const TUTORIAL_STEPS = [
  {
    target: null,
    title: "Welcome to the table",
    body: "You and three bots each start with the same $5 in one shared market. Every action — mining, staking, trading, voting, igniting a star — spends a turn. This tutorial keeps you going first each round so nothing here depends on luck. The goal: understand the table well enough to create Life.",
  },
  {
    target: "wallet",
    title: "Wallet vs. lifetime mass",
    body: "Your wallet can go up or down — it's what you can spend right now. Lifetime mass only ever goes up: every dollar you've actually earned, permanently. It's lifetime mass, not your wallet, that decides how big a star you can ignite later.",
  },
  {
    target: "hydrogen",
    title: "Mining: supply enters through work",
    body: "Extract is free but random — a 'faucet' bringing new supply into the system through effort, not purchase. Try it now.",
    requiresAction: "extract",
    actionHint: "Click Extract above to continue.",
  },
  {
    target: "helium",
    title: "Fixed supply isn't automatically value",
    body: "Helium condenses a little on every turn — anyone's turn — toward a hard cap. That's the Bitcoin pitch. But scarcity alone doesn't create value; it just removes one variable. Demand still has to come from somewhere.",
  },
  {
    target: "market",
    title: "A real market: price impact",
    body: "Every token has its own pool of USD and tokens. Nobody sets the price — it's just the ratio between the two, the same math behind Uniswap. Make a small trade and compare the spot price to what you actually paid.",
    requiresAction: "swap",
    actionHint: "Complete a trade above to continue.",
  },
  {
    target: "fluorine",
    title: "Burning is the key, not a footnote",
    body: "Selling Fluorine destroys a slice of it permanently — deflationary burn. Here, that's not just flavor: you can't synthesize Water later until you've actually burned some yourself. Sell a little now.",
    requiresAction: "burnFluorine",
    actionHint: "Sell some Fluorine on the market above to continue.",
  },
  {
    target: "liquidity",
    title: "Liquidity providing — and impermanent loss",
    body: "Deposit into any pool and you'll earn a cut of every trade in it. But your position can end up worth less than if you'd simply held the tokens, if price moves a lot while you're in it. That gap is impermanent loss.",
    requiresAction: "addLiquidity",
    actionHint: "Add liquidity to any pool above to continue.",
  },
  {
    target: "lithium",
    title: "Inflationary yield: minted from nothing",
    body: "Staking Lithium boosts your Hydrogen mining every single time — market or not. That extra token comes from nowhere but the schedule itself. This is inflationary yield. Keep the contrast in mind for the next step.",
    requiresAction: "toggleBuff",
    actionHint: "Stake Lithium for the buff above to continue.",
  },
  {
    target: "genesis",
    title: "Real yield: paid from actual activity",
    body: "Combine Hydrogen and Helium into a Genesis Compound, then stake it. Unlike Lithium, a staked Alloy earns nothing on its own — it only earns a slice of real trading fees, yours and the bots'. If nobody trades, it earns nothing. That's real yield.",
    requiresAction: "stakeAlloy",
    actionHint: "Combine, then Stake, to continue.",
  },
  {
    target: "governance",
    title: "Governance decides who gets to create Life",
    body: "Beryllium buys you a vote, but the Treasury bloc votes no by default — your proposal can genuinely fail. A stalled star (next step) adds voting weight too, so a failed star isn't wasted. Submit a proposal now, whatever the outcome.",
    requiresAction: "propose",
    actionHint: "Submit a proposal above to continue.",
  },
  {
    target: "fusion",
    title: "Ignite: lifetime mass becomes a star",
    body: "Ignition costs a flat $2. The class of star you get is fixed by your lifetime mass right now, not your wallet balance — so a bad trade right after can't shrink it. Ignite when ready.",
    requiresAction: "ignite",
    actionHint: "Ignite a star above to continue.",
  },
  {
    target: "fusion",
    title: "Fusion, stalling, and the finish line",
    body: "Your star fuses on its own clock, Hydrogen through Iron. Small stars stall out before Iron — expected, not a bug, and it still earns governance weight. Reach Iron and trigger the supernova yourself; its output, plus what you've already burned, staked, and voted on, is what lets you craft Water, a Planet, and finally Life. That's the whole table.",
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────
function getAmountOut(amountIn, reserveIn, reserveOut) {
  if (amountIn <= 0 || reserveIn <= 0 || reserveOut <= 0) return 0;
  const amountInWithFee = amountIn * (10000 - FEE_BPS) / 10000;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn + amountInWithFee;
  return numerator / denominator;
}
function randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function tokenNetWorth(elements, pools) {
  return POOL_KEYS.reduce((sum, k) => sum + (elements[k] || 0) * (pools[k].usd / pools[k].token), 0);
}

// Pure swap — takes a generic { usd, elements, ... } actor, returns a new
// one. Used identically for the human and for every bot; nothing about the
// caller's identity changes the math.
function applySwap(actor, pools, tokenKey, direction, size) {
  const pool = pools[tokenKey];
  const r = RESOURCES[tokenKey];
  const newActor = { ...actor, elements: { ...actor.elements } };

  if (direction === "buy") {
    const usdAmt = Math.min(size, actor.usd);
    if (usdAmt <= 0.01) return { executed: false };
    const amountOut = getAmountOut(usdAmt, pool.usd, pool.token);
    if (amountOut <= 0) return { executed: false };
    newActor.usd -= usdAmt;
    newActor.elements[tokenKey] = (newActor.elements[tokenKey] || 0) + amountOut;
    const newUsd = pool.usd + usdAmt, newToken = pool.token - amountOut;
    const newPools = { ...pools, [tokenKey]: { ...pool, usd: newUsd, token: newToken, priceHistory: [...pool.priceHistory, newUsd / newToken].slice(-30) } };
    return { executed: true, actor: newActor, pools: newPools, valueUsd: usdAmt, summary: `bought ${amountOut.toFixed(2)} ${r.symbol} for $${usdAmt.toFixed(2)}` };
  } else {
    const tokenAmt = Math.min(size, actor.elements[tokenKey] || 0);
    if (tokenAmt <= 0.01) return { executed: false };
    const burnRate = tokenKey === "fluorine" ? FLUORINE_BURN_RATE : 0;
    const amtAfterBurn = tokenAmt * (1 - burnRate);
    const amountOut = getAmountOut(amtAfterBurn, pool.token, pool.usd);
    if (amountOut <= 0) return { executed: false };
    newActor.elements[tokenKey] -= tokenAmt;
    newActor.usd += amountOut;
    const newToken = pool.token + amtAfterBurn, newUsd = pool.usd - amountOut;
    const newPools = { ...pools, [tokenKey]: { ...pool, usd: newUsd, token: newToken, priceHistory: [...pool.priceHistory, newUsd / newToken].slice(-30) } };
    const burnedAmount = tokenAmt - amtAfterBurn;
    return { executed: true, actor: newActor, pools: newPools, valueUsd: amountOut, earnedUsd: amountOut, burnedAmount, summary: `sold ${tokenAmt.toFixed(2)} ${r.symbol} for $${amountOut.toFixed(2)}${burnRate > 0 ? ` (${burnedAmount.toFixed(3)} burned in transfer)` : ""}` };
  }
}

// Bot decision — pure function of (bot, pools). Deliberately small action
// space: extract, toggle the Lithium buff, or swap. Nothing else, for now.
function decideBotAction(bot) {
  if (bot.elements.lithium > 0 && Math.random() < 0.1) return { type: "toggleBuff" };

  if (bot.archetype === "noble") {
    return Math.random() < 0.75 ? { type: "extract" } : { type: "pass" };
  }
  if (bot.archetype === "halogen") {
    const held = POOL_KEYS.filter(k => (bot.elements[k] || 0) > 0.5);
    if (held.length && Math.random() < 0.3) {
      const tokenKey = held[randInt(0, held.length - 1)];
      return { type: "swap", tokenKey, direction: "sell", size: bot.elements[tokenKey] * 0.5 };
    }
    // indices 0-4 = the original five pools; deuterium (index 5) is
    // deliberately excluded from bot trading for now, same v1 scope cut
    // as bots never touching Alloy staking or farming.
    if (bot.usd > 0.5 && Math.random() < 0.35) {
      return { type: "swap", tokenKey: POOL_KEYS[randInt(0, 4)], direction: "buy", size: Math.min(bot.usd, randInt(1, 2)) };
    }
    return { type: "extract" };
  }
  // alkali — trades often, chases either direction
  if (bot.usd > 0.3 && Math.random() < 0.7) {
    const tokenKey = POOL_KEYS[randInt(0, 4)];
    let direction = Math.random() < 0.55 ? "buy" : "sell";
    if (direction === "sell" && (!bot.elements[tokenKey] || bot.elements[tokenKey] < 0.5)) direction = "buy";
    const size = direction === "buy" ? Math.min(bot.usd, randInt(1, 3)) : Math.min(bot.elements[tokenKey], randInt(1, 3));
    return { type: "swap", tokenKey, direction, size };
  }
  return { type: "extract" };
}

// ─────────────────────────────────────────────────────────────────────────
// UI atoms
// ─────────────────────────────────────────────────────────────────────────
const C = {
  bg: "#0a0d0f", elev: "#12161a", elev2: "#171c21", border: "rgba(255,255,255,0.12)",
  text: "#f2f2f2", muted: "#8a94a0", accent: "#5b9dff", green: "#7dffb0", red: "#ff8080", orange: "#ff9d6c", purple: "#c98cff",
};

function Sparkline({ data, color }) {
  if (!data || data.length < 2) return <svg viewBox="0 0 100 24" className="w-full h-6"><line x1="0" y1="12" x2="100" y2="12" stroke={color} strokeOpacity="0.3" /></svg>;
  const min = Math.min(...data), max = Math.max(...data), range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 100},${23 - ((v - min) / range) * 21}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  return <svg viewBox="0 0 100 24" className="w-full h-6" preserveAspectRatio="none"><polyline points={points} fill="none" stroke={up ? C.green : C.red} strokeWidth="1.5" /></svg>;
}
function Btn({ children, onClick, disabled, tone = "default", small }) {
  const style = tone === "accent"
    ? { background: C.accent, color: "#050708", borderColor: C.accent }
    : { background: C.bg, color: C.text, borderColor: C.border };
  return (
    <button type="button" onClick={onClick} disabled={disabled} style={style}
      className={`rounded-xl ${small ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-2 text-xs"} font-medium transition border hover:opacity-90 ${disabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer"}`}>
      {children}
    </button>
  );
}
function Card({ children, glow, className = "" }) {
  return (
    <div className={`rounded-2xl border p-4 transition ${className}`}
      style={{ borderColor: glow ? C.accent : C.border, background: C.elev, boxShadow: glow ? `0 0 0 1px ${C.accent}` : "none" }}>
      {children}
    </div>
  );
}
function SectionLabel({ children }) {
  return <p className="text-[11px] font-semibold uppercase tracking-widest mb-2" style={{ color: C.muted }}>{children}</p>;
}

// Spotlight overlay — highlights real UI rather than faking a separate
// walkthrough. Ported from ElementLab.jsx's tutorial pattern.
function TutorialOverlay({ step, index, total, rect, onNext, onBack, onSkip, canAdvance, actionHint }) {
  const maskColor = "rgba(0,0,0,0.72)";
  const pad = 8;
  let tooltipStyle = { position: "fixed", zIndex: 51, maxWidth: "min(320px, calc(100vw - 32px))" };
  if (rect) {
    const spaceBelow = window.innerHeight - (rect.top + rect.height);
    const placeBelow = spaceBelow > 200;
    tooltipStyle.left = Math.max(16, Math.min(rect.left, window.innerWidth - 340));
    tooltipStyle.top = placeBelow ? rect.top + rect.height + pad + 8 : Math.max(16, rect.top - pad - 8 - 220);
  } else {
    tooltipStyle.left = "50%";
    tooltipStyle.top = "50%";
    tooltipStyle.transform = "translate(-50%, -50%)";
  }
  return (
    <>
      {rect ? (
        <>
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: Math.max(0, rect.top - pad), background: maskColor, zIndex: 49 }} />
          <div style={{ position: "fixed", top: rect.top + rect.height + pad, left: 0, right: 0, bottom: 0, background: maskColor, zIndex: 49 }} />
          <div style={{ position: "fixed", top: rect.top - pad, left: 0, width: Math.max(0, rect.left - pad), height: rect.height + pad * 2, background: maskColor, zIndex: 49 }} />
          <div style={{ position: "fixed", top: rect.top - pad, left: rect.left + rect.width + pad, right: 0, height: rect.height + pad * 2, background: maskColor, zIndex: 49 }} />
          <div style={{ position: "fixed", top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2, border: `2px solid ${C.accent}`, borderRadius: 16, boxShadow: "0 0 24px rgba(91,157,255,0.35)", pointerEvents: "none", zIndex: 50 }} />
        </>
      ) : (
        <div style={{ position: "fixed", inset: 0, background: maskColor, zIndex: 49 }} />
      )}
      <div style={{ ...tooltipStyle, background: "rgba(8,10,12,0.96)", backdropFilter: "blur(6px)", border: `1px solid ${C.accent}`, borderRadius: 16, padding: 16, boxShadow: "0 8px 30px rgba(0,0,0,0.5)" }}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: C.accent }}>Step {index + 1} of {total}</p>
          <button onClick={onSkip} className="text-[11px] transition" style={{ color: "rgba(255,255,255,0.5)" }}>Skip tutorial</button>
        </div>
        <h3 className="text-sm font-semibold mb-1.5" style={{ color: "rgba(255,255,255,0.95)" }}>{step.title}</h3>
        <p className="text-xs leading-5 mb-3" style={{ color: "rgba(255,255,255,0.65)" }}>{step.body}</p>
        {step.requiresAction && !canAdvance && (
          <p className="text-[11px] mb-3" style={{ color: C.accent }}>{actionHint}</p>
        )}
        <div className="flex items-center justify-between gap-2">
          <Btn onClick={onBack} disabled={index === 0}>Back</Btn>
          <Btn onClick={onNext} disabled={!canAdvance} tone="accent">{index === total - 1 ? "Finish" : "Next"}</Btn>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────
export default function ElementGame() {
  const [phase, setPhase] = useState("lobby"); // 'lobby' | 'playing' | 'life'

  // ── Human economy state ─────────────────────────────────────────────
  const [usd, setUsd] = useState(STARTING_USD);
  const [lifetimeMass, setLifetimeMass] = useState(0);
  const [elements, setElements] = useState(freshElementBalances());
  const [crafted, setCrafted] = useState({ water: 0, planet: 0, life: 0 });
  const [lithiumBuffActive, setLithiumBuffActive] = useState(false);
  const [compound, setCompound] = useState(0);
  const [stakedCompound, setStakedCompound] = useState(0);
  const [pendingAlloyReward, setPendingAlloyReward] = useState(0);
  const [proposalsSubmitted, setProposalsSubmitted] = useState(0);
  const [heliumProgress, setHeliumProgress] = useState(0);
  const [fluorineBurnedLifetime, setFluorineBurnedLifetime] = useState(0);
  const [planetLock, setPlanetLock] = useState(null); // null | { turnsRemaining, locked: {silicon,oxygen,magnesium,iron} }
  const [deadStars, setDeadStars] = useState(0);
  const [abiogenesisRatified, setAbiogenesisRatified] = useState(false);

  const [period1BonusActive, setPeriod1BonusActive] = useState(false);
  const [period1BonusTurnsRemaining, setPeriod1BonusTurnsRemaining] = useState(0);
  const [period1BonusArmed, setPeriod1BonusArmed] = useState(true);

  // ── Fusion / Life race (human only). turnsInStage counts turns taken
  // (by anyone) toward the current stage's turnsPerStage requirement —
  // this is what replaced the old wall-clock setTimeout. ───────────────
  const [fusion, setFusion] = useState({ active: false, class: null, stageIndex: -1, effectiveMax: 0, stalled: false, readyForSupernova: false, wentSupernova: false, breakthroughUsed: false, turnsInStage: 0 });
  const [starsIgnited, setStarsIgnited] = useState(0);

  // ── Deuterium: fixed-APR staking ─────────────────────────────────────
  const [deuteriumStaked, setDeuteriumStaked] = useState(0);
  const [deuteriumEpochProgress, setDeuteriumEpochProgress] = useState(0); // turns elapsed toward next epoch
  const [deuteriumPendingReward, setDeuteriumPendingReward] = useState(0);
  const [deuteriumStakeInput, setDeuteriumStakeInput] = useState("");

  // ── Two-sided liquidity farming ──────────────────────────────────────
  const [farmPools, setFarmPools] = useState(freshFarmPools());
  const [farmPositions, setFarmPositions] = useState({}); // { [pairKey]: { shares, autoCompound } }
  const [farmPendingReward, setFarmPendingReward] = useState({}); // { [pairKey]: amount, in reward-token units }
  const [farmDepositInput, setFarmDepositInput] = useState({});

  // ── Shared market ────────────────────────────────────────────────────
  const [pools, setPools] = useState(freshPools());
  const [lpPositions, setLpPositions] = useState({});
  const [feeStats, setFeeStats] = useState({ lp: 0, staker: 0, treasury: 0, burn: 0 });
  const [lastFeeSplit, setLastFeeSplit] = useState(null);

  // ── Bots ─────────────────────────────────────────────────────────────
  const [bots, setBots] = useState([]);

  // ── Turn engine ──────────────────────────────────────────────────────
  const [roundOrder, setRoundOrder] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [roundNumber, setRoundNumber] = useState(1);
  const [turnNumber, setTurnNumber] = useState(0);

  const [log, setLog] = useState([]);
  const [flashCard, setFlashCard] = useState(null);
  const flashTimeoutRef = useRef(null);

  // ── Market UI ────────────────────────────────────────────────────────
  const [marketMode, setMarketMode] = useState("swap");
  const [swapTokenKey, setSwapTokenKey] = useState("hydrogen");
  const [swapDirection, setSwapDirection] = useState("buy");
  const [swapAmount, setSwapAmount] = useState("");
  const [lpAmount, setLpAmount] = useState("");

  const [showProposalModal, setShowProposalModal] = useState(false);
  const [lastProposalResult, setLastProposalResult] = useState(null);

  // ── Tutorial mode ────────────────────────────────────────────────────
  const [tutorialActive, setTutorialActive] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialActionDone, setTutorialActionDone] = useState(false);
  const [highlightRect, setHighlightRect] = useState(null);
  const targetRefs = useRef({});
  const registerRef = (name) => (el) => { targetRefs.current[name] = el; };
  const currentTutorialStep = tutorialActive ? TUTORIAL_STEPS[tutorialStep] : null;
  const canAdvanceTutorial = !currentTutorialStep?.requiresAction || tutorialActionDone;

  // Marks the current tutorial step's required action as done, if it
  // matches. Called from inside the relevant action functions below —
  // this is how "the gameplay itself teaches the concept" instead of a
  // separate checklist bolted on top.
  function markTutorialAction(key) {
    if (tutorialActive && currentTutorialStep?.requiresAction === key) setTutorialActionDone(true);
  }

  const isHumanTurn = phase === "playing" && roundOrder[currentIndex] === "human";

  function pushLog(text) {
    setLog(prev => [{ text, ts: Date.now() }, ...prev].slice(0, 40));
  }
  function flash(key) {
    setFlashCard(key);
    clearTimeout(flashTimeoutRef.current);
    flashTimeoutRef.current = setTimeout(() => setFlashCard(null), 450);
  }

  // ── Tutorial navigation ─────────────────────────────────────────────
  function nextTutorialStep() {
    if (tutorialStep >= TUTORIAL_STEPS.length - 1) { setTutorialActive(false); return; }
    setTutorialStep(s => s + 1);
    setTutorialActionDone(false);
  }
  function prevTutorialStep() {
    setTutorialStep(s => Math.max(0, s - 1));
    setTutorialActionDone(false);
  }
  function skipTutorial() { setTutorialActive(false); }

  // Switch the market tab to match whatever the current step needs to show.
  useEffect(() => {
    if (!tutorialActive) return;
    const step = TUTORIAL_STEPS[tutorialStep];
    if (step?.target === "liquidity") setMarketMode("liquidity");
    if (step?.target === "market") setMarketMode("swap");
  }, [tutorialActive, tutorialStep]);

  // Scroll the spotlighted element into view whenever the step changes.
  useEffect(() => {
    if (!tutorialActive) return;
    const step = TUTORIAL_STEPS[tutorialStep];
    if (step?.target) {
      const el = targetRefs.current[step.target];
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [tutorialActive, tutorialStep]);

  // Track the spotlighted element's screen position every frame — cheap
  // enough at tutorial scale, and it keeps the highlight glued to the
  // element through scrolling, resizing, or layout shifts.
  useEffect(() => {
    if (!tutorialActive) return;
    let raf;
    function loop() {
      const step = TUTORIAL_STEPS[tutorialStep];
      if (step?.target) {
        const el = targetRefs.current[step.target];
        if (el) {
          const r = el.getBoundingClientRect();
          setHighlightRect(prev => (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height) ? prev : { top: r.top, left: r.left, width: r.width, height: r.height });
        }
      } else {
        setHighlightRect(prev => (prev === null ? prev : null));
      }
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [tutorialActive, tutorialStep]);

  // ── Start / reset ────────────────────────────────────────────────────
  function startGame(withTutorial = false) {
    setUsd(STARTING_USD);
    setLifetimeMass(0);
    setElements(freshElementBalances());
    setCrafted({ water: 0, planet: 0, life: 0 });
    setLithiumBuffActive(false);
    setCompound(0);
    setStakedCompound(0);
    setPendingAlloyReward(0);
    setProposalsSubmitted(0);
    setHeliumProgress(0);
    setFluorineBurnedLifetime(0);
    setPlanetLock(null);
    setDeadStars(0);
    setAbiogenesisRatified(false);
    setPeriod1BonusActive(false);
    setPeriod1BonusTurnsRemaining(0);
    setPeriod1BonusArmed(true);
    setFusion({ active: false, class: null, stageIndex: -1, effectiveMax: 0, stalled: false, readyForSupernova: false, wentSupernova: false, breakthroughUsed: false, turnsInStage: 0 });
    setStarsIgnited(0);
    setDeuteriumStaked(0);
    setDeuteriumEpochProgress(0);
    setDeuteriumPendingReward(0);
    setDeuteriumStakeInput("");
    setFarmPools(freshFarmPools());
    setFarmPositions({});
    setFarmPendingReward({});
    setFarmDepositInput({});
    setPools(freshPools());
    setLpPositions({});
    setFeeStats({ lp: 0, staker: 0, treasury: 0, burn: 0 });
    setLastFeeSplit(null);
    setBots(BOT_ROSTER.map(b => ({ ...b, usd: STARTING_USD, elements: { hydrogen: 0, helium: 0, lithium: 0, fluorine: 0, beryllium: 0 }, lithiumBuffActive: false })));
    setRoundOrder(withTutorial ? ["human", ...BOT_ROSTER.map(b => b.id)] : shuffle(["human", ...BOT_ROSTER.map(b => b.id)]));
    setCurrentIndex(0);
    setRoundNumber(1);
    setTurnNumber(0);
    setLog([]);
    setTutorialActive(withTutorial);
    setTutorialStep(0);
    setTutorialActionDone(false);
    setMarketMode("swap");
    setPhase("playing");
  }

  // ── Turn advancement ─────────────────────────────────────────────────
  // Every mechanic in this game that used to run on a real-time clock now
  // ticks exactly once here, per turn taken — by anyone, human or bot.
  // That's the whole "turns, not timers" rule in one place.
  function advanceTurn() {
    setTurnNumber(t => t + 1);
    tickHeliumCondensation();
    tickPeriod1BonusCountdown();
    tickPlanetLock();
    tickFusion();
    tickDeuteriumStaking();
    tickFarms();
    const next = currentIndex + 1;
    if (next >= roundOrder.length) {
      // Tutorial mode keeps the human first every round — nothing in the
      // curriculum should depend on winning the turn-order shuffle.
      setRoundOrder(tutorialActive ? ["human", ...BOT_ROSTER.map(b => b.id)] : shuffle(["human", ...BOT_ROSTER.map(b => b.id)]));
      setRoundNumber(r => r + 1);
      setCurrentIndex(0);
    } else {
      setCurrentIndex(next);
    }
  }

  // Helium condenses a little on every single turn taken — yours or a
  // bot's — rather than on a real-time clock. It's still a passive drip
  // (no turn is spent to make it happen), just paced by game activity
  // instead of a wall-clock timer.
  function tickHeliumCondensation() {
    setHeliumProgress(p => {
      const next = p + randInt(15, 30);
      if (next >= 100) {
        const chance = Math.min(1, HELIUM_CHANCE * (period1BonusActive ? PERIOD1_BONUS_MULT : 1));
        if (Math.random() < chance) {
          setElements(e => ({ ...e, helium: e.helium + 1 }));
          pushLog("Helium condensed quietly. +1 He");
          flash("helium");
        }
        return next - 100;
      }
      return next;
    });
  }
  // Counts down the Period 1 bonus window in turns instead of seconds.
  function tickPeriod1BonusCountdown() {
    if (!period1BonusActive) return;
    setPeriod1BonusTurnsRemaining(t => {
      if (t <= 1) { setPeriod1BonusActive(false); return 0; }
      return t - 1;
    });
  }

  // A Planet accretes over a fixed number of turns instead of a fixed
  // number of seconds — same staking-lockup tradeoff, just paced by
  // gameplay instead of a wall clock.
  function tickPlanetLock() {
    setPlanetLock(pl => {
      if (!pl) return pl;
      if (pl.turnsRemaining <= 1) {
        setCrafted(c => ({ ...c, planet: c.planet + 1 }));
        pushLog("The locked material finished accreting — a Planet has formed.");
        return null;
      }
      return { ...pl, turnsRemaining: pl.turnsRemaining - 1 };
    });
  }

  // The star's fusion clock — replaces the old setTimeout(tickMs) effect.
  // Every turn taken (by anyone) counts toward the current stage's
  // turnsPerStage requirement; once it's met, the star either advances,
  // punches through (Sun-like breakthrough check), or stalls.
  function tickFusion() {
    setFusion(f => {
      if (!f.active || f.stalled || f.readyForSupernova) return f;
      const turnsNeeded = CLASS_CONFIG[f.class].turnsPerStage;
      const turnsInStage = (f.turnsInStage || 0) + 1;
      if (turnsInStage < turnsNeeded) return { ...f, turnsInStage };
      const nextIndex = f.stageIndex + 1;
      if (nextIndex > f.effectiveMax) {
        if (f.class === "sunLike" && !f.breakthroughUsed) {
          const success = Math.random() < CLASS_CONFIG.sunLike.breakthroughChance;
          if (success) {
            pushLog("Your Sun-like star punched through — fusion continues toward Iron.");
            return { ...f, effectiveMax: 6, breakthroughUsed: true, turnsInStage: 0 };
          }
        }
        pushLog(`Fusion stalled after ${FUSION_STAGES[f.stageIndex]}. The star became a white dwarf — but the attempt still counts toward a future governance vote.`);
        setDeadStars(n => n + 1);
        return { ...f, stalled: true };
      }
      const stageName = FUSION_STAGES[nextIndex];
      const yieldAmt = STAGE_YIELD[stageName];
      setElements(e => ({ ...e, [stageName]: e[stageName] + yieldAmt }));
      pushLog(`Your star fused ${stageName === "helium" ? "Hydrogen" : FUSION_STAGES[nextIndex - 1] || "Hydrogen"} into ${stageName}. +${yieldAmt}`);
      const readyForSupernova = nextIndex === 6;
      if (readyForSupernova) pushLog("Iron reached. The core can no longer release energy by fusing — trigger the supernova when ready.");
      return { ...f, stageIndex: nextIndex, readyForSupernova, turnsInStage: 0 };
    });
  }

  // Deuterium staking: a fixed-APR contract. Every DEUTERIUM_EPOCH_TURNS
  // turns (anyone's), a staked position pays out exactly 10% of principal
  // — guaranteed, whether or not any trading happened at all. The direct
  // opposite of Genesis Alloy staking, which pays nothing without real
  // swap volume.
  function tickDeuteriumStaking() {
    if (deuteriumStaked <= 0) return;
    setDeuteriumEpochProgress(p => {
      const next = p + 1;
      if (next >= DEUTERIUM_EPOCH_TURNS) {
        const reward = deuteriumStaked * DEUTERIUM_APR;
        setDeuteriumPendingReward(r => r + reward);
        pushLog(`Deuterium epoch complete — +${reward.toFixed(3)} D, guaranteed, unaffected by market activity.`);
        return 0;
      }
      return next;
    });
  }

  // Two-sided liquidity farming: an emission per turn, proportional to
  // your share of the pool — not a cut of swap fees. Auto-compound
  // reinvests half of every reward straight back into new LP shares
  // (v1 simplification: FARM_COMPOUND_SHARE_RATE stands in for a real
  // sell-then-deposit); the rest always accumulates as claimable, cashed
  // out at a fixed rate (FARM_REWARD_USD_VALUE) since reward tokens don't
  // have their own market yet.
  function tickFarms() {
    Object.entries(FARM_PAIRS).forEach(([key, pair]) => {
      const pos = farmPositions[key];
      if (!pos || pos.shares <= 0) return;
      const gross = pos.shares * pair.ratePerShare;
      if (pos.autoCompound) {
        const compoundAmt = gross * FARM_COMPOUND_SPLIT;
        const cashAmt = gross - compoundAmt;
        const sharesMinted = compoundAmt * FARM_COMPOUND_SHARE_RATE;
        setFarmPools(prev => ({ ...prev, [key]: { ...prev[key], totalShares: prev[key].totalShares + sharesMinted } }));
        setFarmPositions(prev => ({ ...prev, [key]: { ...prev[key], shares: prev[key].shares + sharesMinted } }));
        setFarmPendingReward(prev => ({ ...prev, [key]: (prev[key] || 0) + cashAmt }));
      } else {
        setFarmPendingReward(prev => ({ ...prev, [key]: (prev[key] || 0) + gross }));
      }
    });
  }

  function runAction(actionFn) {
    if (!isHumanTurn) return;
    const executed = actionFn();
    if (executed) advanceTurn();
  }

  // ── Bot turn resolution ──────────────────────────────────────────────
  useEffect(() => {
    if (phase !== "playing") return;
    const actorId = roundOrder[currentIndex];
    if (actorId === "human" || actorId === undefined) return;
    const bot = bots.find(b => b.id === actorId);
    if (!bot) return;
    const t = setTimeout(() => {
      resolveBotTurn(bot);
      advanceTurn();
    }, BOT_TURN_DELAY_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex, roundOrder]);

  function resolveBotTurn(bot) {
    const action = decideBotAction(bot);
    let updatedBot = { ...bot, elements: { ...bot.elements } };
    let updatedPools = pools;
    let logMsg = "passed";

    if (action.type === "extract") {
      const buffMult = updatedBot.lithiumBuffActive && updatedBot.elements.lithium > 0 ? LITHIUM_BUFF_MULT : 1;
      const yieldAmt = Math.round(randInt(2, 5) * buffMult);
      updatedBot.elements.hydrogen += yieldAmt;
      logMsg = `mined ${yieldAmt} H`;
      if (Math.random() < LITHIUM_DROP_CHANCE) { updatedBot.elements.lithium += 1; logMsg += " and found 1 Li"; }
    } else if (action.type === "toggleBuff") {
      updatedBot.lithiumBuffActive = !updatedBot.lithiumBuffActive;
      logMsg = updatedBot.lithiumBuffActive ? "staked Lithium for a mining buff" : "unstaked Lithium";
    } else if (action.type === "swap") {
      const result = applySwap(bot, pools, action.tokenKey, action.direction, action.size);
      if (result.executed) {
        updatedBot = result.actor;
        updatedPools = result.pools;
        logMsg = result.summary;
        routeSwapFee(result.valueUsd, RESOURCES[action.tokenKey].symbol);
      } else {
        logMsg = "tried to trade but couldn't";
      }
    }

    setBots(prev => prev.map(b => (b.id === bot.id ? updatedBot : b)));
    setPools(updatedPools);
    pushLog(`${BOT_ARCHETYPES[bot.archetype].icon} ${bot.name} ${logMsg}.`);
  }

  // ── Fee routing (shared — any swap by anyone routes fees) ───────────
  function routeSwapFee(swapValueUsd, symbol) {
    const feeUsd = swapValueUsd * FEE_BPS / 10000;
    const split = { lp: feeUsd * FEE_SPLIT.lp, staker: feeUsd * FEE_SPLIT.staker, treasury: feeUsd * FEE_SPLIT.treasury, burn: feeUsd * FEE_SPLIT.burn };
    setFeeStats(prev => ({ lp: prev.lp + split.lp, staker: prev.staker + split.staker, treasury: prev.treasury + split.treasury, burn: prev.burn + split.burn }));
    setLastFeeSplit({ ...split, total: feeUsd, symbol });
    if (stakedCompound > 0) setPendingAlloyReward(p => p + split.staker);
  }

  // Alloy staking intentionally has NO flat trickle. Unlike Lithium's
  // mining buff (which always fires, market or not — that's inflationary
  // yield, minted from nothing), a staked Alloy only earns when someone —
  // you or a bot — actually trades. See routeSwapFee(). If the market goes
  // quiet, pendingAlloyReward simply stops growing. That contrast is the
  // whole lesson, and it's felt rather than explained.

  // ── Period 1 completion detector: H + He + a staked Alloy, all at once ──
  // Activation is still event-driven (fires the moment the condition is
  // true); the countdown itself now ticks in turns via
  // tickPeriod1BonusCountdown(), called from advanceTurn().
  useEffect(() => {
    if (stakedCompound <= 0) { setPeriod1BonusArmed(true); return; }
    if (period1BonusArmed && elements.hydrogen > 0 && elements.helium > 0) {
      setPeriod1BonusActive(true);
      setPeriod1BonusTurnsRemaining(PERIOD1_BONUS_TURNS);
      setPeriod1BonusArmed(false);
      pushLog(`Period 1 complete — H, He, and a staked Genesis Alloy, all at once. 1.5x mining boost for ${PERIOD1_BONUS_TURNS} turns.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements.hydrogen, elements.helium, stakedCompound, period1BonusArmed]);

  // Fusion stage advancement and Planet accretion no longer have their own
  // wall-clock effects — see tickFusion() and tickPlanetLock(), both
  // called once per turn from advanceTurn().

  // ── Human actions (all return true/false: executed?) ────────────────
  function extractHydrogen() {
    const buffMult = (lithiumBuffActive && elements.lithium > 0 ? LITHIUM_BUFF_MULT : 1) * (period1BonusActive ? PERIOD1_BONUS_MULT : 1);
    const yieldAmt = Math.round(randInt(2, 5) * buffMult);
    setElements(e => ({ ...e, hydrogen: e.hydrogen + yieldAmt }));
    flash("hydrogen");
    let msg = `Mined ${yieldAmt} Hydrogen${buffMult > 1 ? " (boosted)" : ""}.`;
    if (Math.random() < LITHIUM_DROP_CHANCE) { setElements(e => ({ ...e, lithium: e.lithium + 1 })); msg += " A Lithium deposit surfaced. +1 Li"; }
    pushLog(msg);
    markTutorialAction("extract");
    return true;
  }
  function extractFluorine() {
    const yieldAmt = randInt(1, 3);
    setElements(e => ({ ...e, fluorine: e.fluorine + yieldAmt }));
    flash("fluorine");
    pushLog(`Corroded ${yieldAmt} Fluorine out of raw material.`);
    return true;
  }
  function toggleLithiumBuff() {
    if (elements.lithium <= 0 && !lithiumBuffActive) return false;
    if (!lithiumBuffActive) markTutorialAction("toggleBuff"); // about to turn ON
    setLithiumBuffActive(v => !v);
    pushLog(!lithiumBuffActive ? "Lithium staked beside the extractor — Hydrogen yield +50%." : "Lithium unstaked.");
    return true;
  }
  function combineGenesis() {
    if (elements.hydrogen < GENESIS_COST.hydrogen || elements.helium < GENESIS_COST.helium) return false;
    setElements(e => ({ ...e, hydrogen: e.hydrogen - GENESIS_COST.hydrogen, helium: e.helium - GENESIS_COST.helium }));
    setCompound(c => c + 1);
    flash("compound");
    let msg = `Genesis reaction: ${GENESIS_COST.hydrogen} H + ${GENESIS_COST.helium} He → 1 Genesis Compound.`;
    if (Math.random() < BERYLLIUM_DROP_CHANCE) { setElements(e => ({ ...e, beryllium: e.beryllium + 1 })); msg += " Trace Beryllium condensed out. +1 Be"; }
    pushLog(msg);
    return true;
  }
  function stakeGenesis() {
    if (compound <= 0) return false;
    setStakedCompound(s => s + compound);
    pushLog(`Staked ${compound} Genesis LP — you'll now earn a share of real trading fees, yours and the bots', for as long as it stays staked.`);
    setCompound(0);
    flash("alloy");
    markTutorialAction("stakeAlloy");
    return true;
  }
  function unstakeGenesis() {
    if (stakedCompound <= 0) return false;
    setCompound(c => c + stakedCompound);
    pushLog(`Unstaked ${stakedCompound} Genesis LP.`);
    setStakedCompound(0);
    return true;
  }
  function claimAlloyReward() {
    if (pendingAlloyReward <= 0) return false;
    const amt = pendingAlloyReward;
    setUsd(u => u + amt);
    setLifetimeMass(m => m + amt);
    setPendingAlloyReward(0);
    pushLog(`Claimed $${amt.toFixed(3)} in Alloy staking rewards.`);
    flash("wallet");
    return true;
  }

  // ── Deuterium: mining + fixed-APR staking ────────────────────────────
  function extractDeuterium() {
    const yieldAmt = randInt(1, 2);
    setElements(e => ({ ...e, deuterium: e.deuterium + yieldAmt }));
    flash("deuterium");
    pushLog(`Extracted ${yieldAmt} Deuterium from raw material.`);
    return true;
  }
  function stakeDeuterium(amount) {
    if (!amount || amount <= 0 || elements.deuterium < amount) return false;
    setElements(e => ({ ...e, deuterium: e.deuterium - amount }));
    setDeuteriumStaked(s => s + amount);
    pushLog(`Staked ${amount.toFixed(2)} D in the containment field — guaranteed +10% back every ${DEUTERIUM_EPOCH_TURNS} turns, market or no market.`);
    flash("deuterium");
    return true;
  }
  function unstakeDeuterium() {
    if (deuteriumStaked <= 0) return false;
    setElements(e => ({ ...e, deuterium: e.deuterium + deuteriumStaked }));
    pushLog(`Unstaked ${deuteriumStaked.toFixed(2)} D from the containment field.`);
    setDeuteriumStaked(0);
    setDeuteriumEpochProgress(0);
    return true;
  }
  function claimDeuteriumReward() {
    if (deuteriumPendingReward <= 0) return false;
    const amt = deuteriumPendingReward;
    setElements(e => ({ ...e, deuterium: e.deuterium + amt }));
    setDeuteriumPendingReward(0);
    pushLog(`Claimed ${amt.toFixed(3)} D in guaranteed staking rewards.`);
    flash("deuterium");
    return true;
  }

  // ── Two-sided liquidity farming ──────────────────────────────────────
  // Deposits BOTH tokens of a pair, matched to the pair's current ratio —
  // exactly the LUNC/USTC pattern: put up equal value of both sides,
  // earn a third reward token as an emission, not a fee cut.
  function addFarmLiquidity(pairKey, amountA) {
    const pair = FARM_PAIRS[pairKey];
    if (pair.requiresSupernova && !fusion.wentSupernova) return false;
    const pool = farmPools[pairKey];
    if (!amountA || amountA <= 0) return false;
    const ratio = pool.reserveB / pool.reserveA;
    const amountB = amountA * ratio;
    if ((elements[pair.tokenA] || 0) < amountA || (elements[pair.tokenB] || 0) < amountB) {
      pushLog(`Not enough ${RESOURCES[pair.tokenA].symbol}/${RESOURCES[pair.tokenB].symbol} to match that deposit.`);
      return false;
    }
    const sharesMinted = pool.totalShares * (amountA / pool.reserveA);
    setElements(e => ({ ...e, [pair.tokenA]: e[pair.tokenA] - amountA, [pair.tokenB]: e[pair.tokenB] - amountB }));
    setFarmPools(prev => ({ ...prev, [pairKey]: { ...pool, reserveA: pool.reserveA + amountA, reserveB: pool.reserveB + amountB, totalShares: pool.totalShares + sharesMinted } }));
    setFarmPositions(prev => {
      const existing = prev[pairKey];
      return { ...prev, [pairKey]: existing ? { ...existing, shares: existing.shares + sharesMinted } : { shares: sharesMinted, autoCompound: false } };
    });
    pushLog(`Farmed ${pair.label}: deposited ${amountA.toFixed(2)} ${RESOURCES[pair.tokenA].symbol} + ${amountB.toFixed(2)} ${RESOURCES[pair.tokenB].symbol}.`);
    return true;
  }
  function toggleFarmAutoCompound(pairKey) {
    const pos = farmPositions[pairKey];
    if (!pos) return false;
    const turningOn = !pos.autoCompound;
    setFarmPositions(prev => ({ ...prev, [pairKey]: { ...prev[pairKey], autoCompound: turningOn } }));
    pushLog(turningOn
      ? `${FARM_PAIRS[pairKey].label}: auto-compound on — half of every reward now buys back into the pool automatically.`
      : `${FARM_PAIRS[pairKey].label}: auto-compound off — rewards will just accumulate to claim.`);
    return true;
  }
  function claimFarmReward(pairKey) {
    const pending = farmPendingReward[pairKey] || 0;
    if (pending <= 0) return false;
    const usdValue = pending * FARM_REWARD_USD_VALUE;
    setUsd(u => u + usdValue);
    setLifetimeMass(m => m + usdValue);
    setFarmPendingReward(prev => ({ ...prev, [pairKey]: 0 }));
    pushLog(`Claimed ${pending.toFixed(3)} ${RESOURCES[FARM_PAIRS[pairKey].rewardKey].symbol} from ${FARM_PAIRS[pairKey].label} → $${usdValue.toFixed(3)}.`);
    flash("wallet");
    return true;
  }

  function proposeAbiogenesis() {
    if (elements.beryllium < PROPOSAL_COST || abiogenesisRatified) return false;
    const playerWeight = elements.beryllium + deadStars * DEAD_STAR_VOTE_WEIGHT;
    const npcYes = NPC_HOLDERS.filter(n => n.vote === "yes").reduce((s, n) => s + n.be, 0);
    const npcTotal = NPC_HOLDERS.reduce((s, n) => s + n.be, 0);
    const totalWeight = npcTotal + playerWeight;
    const yesWeight = npcYes + playerWeight; // you always vote yes on your own proposal
    const passed = yesWeight / totalWeight > 0.5;
    setElements(e => ({ ...e, beryllium: e.beryllium - PROPOSAL_COST }));
    setProposalsSubmitted(n => n + 1);
    setLastProposalResult({ playerWeight, totalWeight, passed });
    setShowProposalModal(true);
    if (passed) { setAbiogenesisRatified(true); pushLog("Abiogenesis ratified. Life can now be crafted."); }
    else pushLog("Proposal failed to reach majority — the Treasury bloc alone still outweighs you. More Beryllium or more dead stars would tip it.");
    markTutorialAction("propose");
    return true;
  }
  function igniteStar() {
    if (usd < IGNITE_COST || fusion.active) return false;
    const cls = classify(lifetimeMass);
    setUsd(u => u - IGNITE_COST);
    setFusion({ active: true, class: cls, stageIndex: -1, effectiveMax: CLASS_CONFIG[cls].maxStageIndex, stalled: false, readyForSupernova: false, wentSupernova: false, breakthroughUsed: false });
    setStarsIgnited(n => n + 1);
    pushLog(`Ignited a ${CLASS_CONFIG[cls].label} star. Lifetime mass at ignition: $${lifetimeMass.toFixed(2)}.`);
    markTutorialAction("ignite");
    return true;
  }
  function triggerSupernova() {
    if (!fusion.readyForSupernova || fusion.wentSupernova) return false;
    setElements(e => ({ ...e, nitrogen: e.nitrogen + 3, phosphorus: e.phosphorus + 2, sulfur: e.sulfur + 2, carbon: e.carbon + 2, oxygen: e.oxygen + 2 }));
    setFusion(f => ({ ...f, active: false, wentSupernova: true }));
    pushLog("Supernova. The core collapsed and scattered nitrogen, phosphorus, and sulfur across everything you'd already fused.");
    return true;
  }
  // Water requires the materials AND that you've actually burned some
  // Fluorine yourself — the burn isn't a side activity, it's the key.
  function craftWater() {
    if (elements.hydrogen < 2 || elements.oxygen < 1) return false;
    if (fluorineBurnedLifetime < FLUORINE_BURN_UNLOCK) return false;
    setElements(e => ({ ...e, hydrogen: e.hydrogen - 2, oxygen: e.oxygen - 1 }));
    setCrafted(c => ({ ...c, water: c.water + 1 }));
    pushLog("Crafted Water — H₂O.");
    return true;
  }

  // Planet isn't instant. Locking the materials IS how a Planet forms —
  // same tradeoff as any staking lockup: commit for a number of turns, or
  // break early and keep only a fraction back.
  function beginPlanetLock() {
    if (planetLock) return false;
    if (!fusion.wentSupernova || elements.silicon < 2 || elements.oxygen < 2 || elements.magnesium < 1 || elements.iron < 1) return false;
    const locked = { silicon: 2, oxygen: 2, magnesium: 1, iron: 1 };
    setElements(e => ({ ...e, silicon: e.silicon - 2, oxygen: e.oxygen - 2, magnesium: e.magnesium - 1, iron: e.iron - 1 }));
    setPlanetLock({ turnsRemaining: PLANET_LOCK_TURNS, locked });
    pushLog(`Locked ${locked.silicon} Si, ${locked.oxygen} O, ${locked.magnesium} Mg, ${locked.iron} Fe to accrete — ready in ${PLANET_LOCK_TURNS} turns.`);
    return true;
  }
  function breakPlanetLock() {
    if (!planetLock) return false;
    const { locked } = planetLock;
    setElements(e => ({
      ...e,
      silicon: e.silicon + locked.silicon * PLANET_LOCK_BREAK_RETURN,
      oxygen: e.oxygen + locked.oxygen * PLANET_LOCK_BREAK_RETURN,
      magnesium: e.magnesium + locked.magnesium * PLANET_LOCK_BREAK_RETURN,
      iron: e.iron + locked.iron * PLANET_LOCK_BREAK_RETURN,
    }));
    setPlanetLock(null);
    pushLog(`Broke the lock early — only ${PLANET_LOCK_BREAK_RETURN * 100}% of the locked material came back.`);
    return true;
  }

  // Life requires the materials AND a passed governance vote — the table
  // doesn't let you create Life unilaterally.
  function craftLife() {
    if (!abiogenesisRatified) return false;
    if (crafted.planet < 1 || crafted.water < 1 || elements.carbon < 1 || elements.nitrogen < 1 || elements.phosphorus < 1 || elements.sulfur < 1) return false;
    setElements(e => ({ ...e, carbon: e.carbon - 1, nitrogen: e.nitrogen - 1, phosphorus: e.phosphorus - 1, sulfur: e.sulfur - 1 }));
    setCrafted(c => ({ ...c, water: c.water - 1, planet: c.planet - 1, life: 1 }));
    pushLog("Life.");
    setPhase("life");
    return true;
  }
  function passTurn() {
    pushLog("You passed the turn.");
    return true;
  }

  // ── Market: swap quote + execution ───────────────────────────────────
  const quote = useMemo(() => {
    const amt = parseFloat(swapAmount);
    if (!amt || amt <= 0) return null;
    const pool = pools[swapTokenKey];
    if (swapDirection === "buy") {
      const amountOut = getAmountOut(amt, pool.usd, pool.token);
      if (amountOut <= 0) return null;
      const execPrice = amt / amountOut, spot = pool.usd / pool.token;
      return { amountOut, execPrice, spot, impact: (execPrice - spot) / spot };
    } else {
      const burnRate = swapTokenKey === "fluorine" ? FLUORINE_BURN_RATE : 0;
      const amtAfterBurn = amt * (1 - burnRate);
      const amountOut = getAmountOut(amtAfterBurn, pool.token, pool.usd);
      if (amountOut <= 0) return null;
      const execPrice = amountOut / amt, spot = pool.usd / pool.token;
      return { amountOut, execPrice, spot, impact: (spot - execPrice) / spot, burnRate };
    }
  }, [swapAmount, swapDirection, swapTokenKey, pools]);

  function executeSwap() {
    const amt = parseFloat(swapAmount);
    if (!amt || amt <= 0) return false;
    const actor = { usd, elements };
    const result = applySwap(actor, pools, swapTokenKey, swapDirection, amt);
    if (!result.executed) { pushLog("Trade too small, or not enough funds/tokens."); return false; }
    setUsd(result.actor.usd);
    setElements(result.actor.elements);
    setPools(result.pools);
    if (result.earnedUsd) setLifetimeMass(m => m + result.earnedUsd);
    if (result.burnedAmount) setFluorineBurnedLifetime(m => m + result.burnedAmount);
    routeSwapFee(result.valueUsd, RESOURCES[swapTokenKey].symbol);
    pushLog(`You ${result.summary} (${(quote?.impact * 100 || 0).toFixed(1)}% impact).`);
    setSwapAmount("");
    flash("wallet");
    markTutorialAction("swap");
    if (swapTokenKey === "fluorine" && swapDirection === "sell" && result.burnedAmount > 0) markTutorialAction("burnFluorine");
    return true;
  }

  function addLiquidity() {
    const usdAmount = parseFloat(lpAmount);
    if (!usdAmount || usdAmount <= 0) return false;
    const pool = pools[swapTokenKey];
    const price = pool.usd / pool.token;
    const tokenAmount = usdAmount / price;
    if (usd < usdAmount || (elements[swapTokenKey] || 0) < tokenAmount) { pushLog("Not enough USD or tokens to match that deposit."); return false; }
    const sharesMinted = pool.lpTotalShares * (usdAmount / pool.usd);
    setUsd(u => u - usdAmount);
    setElements(e => ({ ...e, [swapTokenKey]: e[swapTokenKey] - tokenAmount }));
    setPools(prev => ({ ...prev, [swapTokenKey]: { ...pool, usd: pool.usd + usdAmount, token: pool.token + tokenAmount, lpTotalShares: pool.lpTotalShares + sharesMinted } }));
    setLpPositions(prev => {
      const existing = prev[swapTokenKey];
      return { ...prev, [swapTokenKey]: existing ? { shares: existing.shares + sharesMinted, usdDeposited: existing.usdDeposited + usdAmount, tokenDeposited: existing.tokenDeposited + tokenAmount } : { shares: sharesMinted, usdDeposited: usdAmount, tokenDeposited: tokenAmount } };
    });
    pushLog(`Added liquidity: $${usdAmount.toFixed(2)} + ${tokenAmount.toFixed(3)} ${RESOURCES[swapTokenKey].symbol}.`);
    setLpAmount("");
    markTutorialAction("addLiquidity");
    return true;
  }
  function removeLiquidity() {
    const position = lpPositions[swapTokenKey];
    if (!position) return false;
    const pool = pools[swapTokenKey];
    const shareFraction = position.shares / pool.lpTotalShares;
    const usdOut = shareFraction * pool.usd, tokenOut = shareFraction * pool.token;
    const price = pool.usd / pool.token;
    const lpValue = usdOut + tokenOut * price;
    setUsd(u => u + usdOut);
    setElements(e => ({ ...e, [swapTokenKey]: e[swapTokenKey] + tokenOut }));
    setLifetimeMass(m => m + lpValue); // v1 simplification: whole withdrawal counts, not just profit
    setPools(prev => ({ ...prev, [swapTokenKey]: { ...pool, usd: pool.usd - usdOut, token: pool.token - tokenOut, lpTotalShares: pool.lpTotalShares - position.shares } }));
    setLpPositions(prev => { const next = { ...prev }; delete next[swapTokenKey]; return next; });
    pushLog(`Withdrew liquidity: $${lpValue.toFixed(2)} total.`);
    return true;
  }

  // ── Derived values ───────────────────────────────────────────────────
  // v1 simplification: Deuterium (staked + pending) is valued at the
  // current market price, and farm LP shares at a flat $0.05/share —
  // rough proxies, same spirit as the Genesis Alloy valuation just above.
  const deuteriumPrice = pools.deuterium.usd / pools.deuterium.token;
  const farmPositionsValue = Object.values(farmPositions).reduce((sum, pos) => sum + (pos.shares || 0) * 0.05, 0);
  const humanNetWorth = usd + tokenNetWorth(elements, pools) + (compound + stakedCompound) * 2 + pendingAlloyReward
    + (deuteriumStaked + deuteriumPendingReward) * deuteriumPrice + farmPositionsValue;
  const canCombine = elements.hydrogen >= GENESIS_COST.hydrogen && elements.helium >= GENESIS_COST.helium;
  const canPropose = elements.beryllium >= PROPOSAL_COST;
  const period1RemainingTurns = period1BonusTurnsRemaining;
  const planetLockRemainingTurns = planetLock ? planetLock.turnsRemaining : 0;

  const leaderboard = useMemo(() => {
    const rows = [
      { id: "human", name: "You", icon: "🧑", netWorth: humanNetWorth, isHuman: true },
      ...bots.map(b => ({ id: b.id, name: b.name, icon: BOT_ARCHETYPES[b.archetype].icon, netWorth: b.usd + tokenNetWorth(b.elements, pools) })),
    ];
    rows.sort((a, b) => b.netWorth - a.netWorth);
    return rows;
  }, [humanNetWorth, bots, pools]);

  const currentActor = roundOrder[currentIndex];
  const currentActorLabel = currentActor === "human" ? "Your turn" : currentActor ? `${bots.find(b => b.id === currentActor)?.name || "…"} is acting…` : "…";

  // ─────────────────────────────────────────────────────────────────────
  // LOBBY
  // ─────────────────────────────────────────────────────────────────────
  if (phase === "lobby") {
    return (
      <main className="min-h-screen" style={{ background: C.bg, color: C.text }}>
        <div className="mx-auto max-w-2xl px-5 py-10 space-y-6">
          <header className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.accent }}>Element Game — v1</p>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Gather wealth. Ignite a star. Race to create Life.</h1>
            <p className="text-sm leading-6" style={{ color: C.muted }}>
              You and three bots each start with $5 in the same shared market. Every action —
              mining, staking, trading, voting, igniting — spends one turn, and turn order is
              reshuffled every round, so you don't always go first. Your wallet can go up or down;
              your <em>lifetime mass</em> only ever goes up, and it's lifetime mass that decides
              what size star you can ignite when you're ready.
            </p>
          </header>

          <Card>
            <SectionLabel>Who's in the market with you</SectionLabel>
            <div className="space-y-2">
              {BOT_ROSTER.map(b => (
                <div key={b.id} className="flex items-center gap-2 text-xs" style={{ color: C.muted }}>
                  <span className="text-base">{BOT_ARCHETYPES[b.archetype].icon}</span>
                  <span style={{ color: C.text }} className="font-medium">{b.name}</span>
                  <span>— {BOT_ARCHETYPES[b.archetype].desc}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionLabel>The path to Life</SectionLabel>
            <ol className="text-xs leading-6 list-decimal list-inside" style={{ color: C.muted }}>
              <li>Mine, stake, trade, and vote to build up real earnings — that's your lifetime mass.</li>
              <li>Ignite a star ($2, one turn). Its class is locked in by your lifetime mass right then.</li>
              <li>The star fuses on its own clock, Hydrogen through Iron. Small stars stall early — that's expected, and a dead star still counts for something later.</li>
              <li>Reach Iron, trigger the supernova yourself. Water needs Fluorine you've actually burned; a Planet needs locking real materials for real time; Life needs a governance vote you might not win on the first try.</li>
            </ol>
          </Card>

          <div className="flex gap-2">
            <Btn onClick={() => startGame(true)} tone="accent">Start tutorial</Btn>
            <Btn onClick={() => startGame(false)}>Start free play</Btn>
          </div>
          <p className="text-[11px]" style={{ color: C.muted }}>
            New to this? The tutorial spotlights each mechanic in order and keeps you going first every round.
            Free play shuffles turn order from the start, same rules, no guardrails.
          </p>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // LIFE — end screen
  // ─────────────────────────────────────────────────────────────────────
  if (phase === "life") {
    return (
      <main className="min-h-screen" style={{ background: C.bg, color: C.text }}>
        <div className="mx-auto max-w-xl px-5 py-10 space-y-6 text-center">
          <p className="text-6xl">🧬</p>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.accent }}>Life</p>
          <h1 className="text-2xl font-semibold">You created Life.</h1>
          <p className="text-sm leading-6" style={{ color: C.muted }}>
            New markets are unlocked for you from here — not built yet in this version, but this is
            the door. Everything before this point was proving you understand the table: mining,
            scarcity, staking, burning, price impact, liquidity, governance, and fusion.
          </p>
          <Card>
            <div className="grid grid-cols-2 gap-3 text-xs text-left" style={{ color: C.muted }}>
              <p>Turns taken: <span style={{ color: C.text }} className="font-medium">{turnNumber}</span></p>
              <p>Rounds: <span style={{ color: C.text }} className="font-medium">{roundNumber}</span></p>
              <p>Stars ignited: <span style={{ color: C.text }} className="font-medium">{starsIgnited}</span></p>
              <p>Final class: <span style={{ color: C.text }} className="font-medium">{fusion.class ? CLASS_CONFIG[fusion.class].label : "—"}</span></p>
              <p>Lifetime mass: <span style={{ color: C.text }} className="font-medium">${lifetimeMass.toFixed(2)}</span></p>
              <p>Dead stars: <span style={{ color: C.text }} className="font-medium">{deadStars}</span></p>
              <p>Proposals submitted: <span style={{ color: C.text }} className="font-medium">{proposalsSubmitted}</span></p>
            </div>
          </Card>
          <Btn onClick={startGame} tone="accent">Play again</Btn>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────────────
  // PLAYING
  // ─────────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen" style={{ background: C.bg, color: C.text }}>
      <div className="mx-auto max-w-3xl px-5 py-8 space-y-6">

        {/* Header / turn state */}
        <header className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: C.accent }}>Round {roundNumber} · Turn {turnNumber}</p>
            <h1 className="text-xl font-semibold" style={{ color: isHumanTurn ? C.accent : C.text }}>{currentActorLabel}</h1>
          </div>
          <div ref={registerRef("wallet")} className="text-right">
            <p className="text-[11px]" style={{ color: C.muted }}>wallet</p>
            <p className="text-lg font-semibold tabular-nums">${usd.toFixed(2)}</p>
            <p className="text-[10px]" style={{ color: C.muted }}>lifetime mass: <span style={{ color: C.green }}>${lifetimeMass.toFixed(2)}</span></p>
          </div>
        </header>

        {period1BonusActive && (
          <Card glow>
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold" style={{ color: C.accent }}>Period 1 complete — 1.5x mining boost</p>
              <p className="text-xl font-semibold tabular-nums" style={{ color: C.accent }}>{period1RemainingTurns} turns</p>
            </div>
          </Card>
        )}
        {/* Leaderboard */}
        <div>
          <SectionLabel>Leaderboard</SectionLabel>
          <Card>
            <div className="space-y-1.5">
              {leaderboard.map((e, i) => (
                <div key={e.id} className="flex items-center justify-between text-sm" style={e.isHuman ? { color: C.accent } : { color: C.text }}>
                  <p>#{i + 1} {e.icon} {e.name}</p>
                  <p className="tabular-nums font-medium">${e.netWorth.toFixed(2)}</p>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Mining */}
        <div>
          <SectionLabel>Mine — free, spends a turn</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div ref={registerRef("hydrogen")}>
            <Card glow={flashCard === "hydrogen"}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{RESOURCES.hydrogen.icon} Hydrogen</p>
                  <p className="text-xl font-semibold tabular-nums" style={{ color: RESOURCES.hydrogen.color }}>{Math.floor(elements.hydrogen)}</p>
                </div>
                <Btn onClick={() => runAction(extractHydrogen)} disabled={!isHumanTurn} tone="accent">Extract</Btn>
              </div>
            </Card>
            </div>
            <div ref={registerRef("helium")}>
            <Card glow={flashCard === "helium"}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-semibold">{RESOURCES.helium.icon} Helium</p>
                  <p className="text-xl font-semibold tabular-nums" style={{ color: RESOURCES.helium.color }}>{Math.floor(elements.helium)}</p>
                </div>
                <p className="text-[10px]" style={{ color: C.muted }}>condensing passively</p>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: C.bg }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${heliumProgress}%`, background: RESOURCES.helium.color }} />
              </div>
            </Card>
            </div>
            <div ref={registerRef("lithium")}>
            <Card glow={flashCard === "lithium"}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{RESOURCES.lithium.icon} Lithium</p>
                  <p className="text-xl font-semibold tabular-nums" style={{ color: RESOURCES.lithium.color }}>{Math.floor(elements.lithium)}</p>
                </div>
                <Btn onClick={() => runAction(toggleLithiumBuff)} disabled={!isHumanTurn || (elements.lithium <= 0 && !lithiumBuffActive)} tone={lithiumBuffActive ? "accent" : "default"} small>
                  {lithiumBuffActive ? "Staked +50%" : "Stake buff"}
                </Btn>
              </div>
            </Card>
            </div>
            <div ref={registerRef("fluorine")}>
            <Card glow={flashCard === "fluorine"}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{RESOURCES.fluorine.icon} Fluorine</p>
                  <p className="text-xl font-semibold tabular-nums" style={{ color: RESOURCES.fluorine.color }}>{Math.floor(elements.fluorine)}</p>
                </div>
                <Btn onClick={() => runAction(extractFluorine)} disabled={!isHumanTurn} tone="accent">Corrode</Btn>
              </div>
              <p className="text-[10px] mt-2" style={{ color: fluorineBurnedLifetime >= FLUORINE_BURN_UNLOCK ? C.green : C.muted }}>
                {fluorineBurnedLifetime >= FLUORINE_BURN_UNLOCK
                  ? "Water synthesis unlocked — you've burned enough to prove it."
                  : `Sell some to burn it: ${fluorineBurnedLifetime.toFixed(3)}/${FLUORINE_BURN_UNLOCK} burned. Water needs this.`}
              </p>
            </Card>
            </div>
            <div ref={registerRef("deuterium")}>
            <Card glow={flashCard === "deuterium"}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{RESOURCES.deuterium.icon} Deuterium</p>
                  <p className="text-xl font-semibold tabular-nums" style={{ color: RESOURCES.deuterium.color }}>{elements.deuterium.toFixed(2)}</p>
                </div>
                <Btn onClick={() => runAction(extractDeuterium)} disabled={!isHumanTurn} tone="accent">Extract</Btn>
              </div>
              <p className="text-[10px] mt-2" style={{ color: C.muted }}>Feeds the fixed-APR containment field below — guaranteed yield, no market required.</p>
            </Card>
            </div>
          </div>
        </div>

        {/* Market */}
        <div ref={registerRef("market")}>
          <SectionLabel>Market — shared pools, 0.3% fee</SectionLabel>
          <Card>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-3">
              {POOL_KEYS.map(k => {
                const r = RESOURCES[k], p = pools[k], price = p.usd / p.token, active = swapTokenKey === k;
                return (
                  <button key={k} onClick={() => setSwapTokenKey(k)} className="rounded-xl border p-2 text-left transition" style={{ borderColor: active ? C.accent : C.border, background: active ? "rgba(91,157,255,0.08)" : C.bg }}>
                    <p className="text-[10px]" style={{ color: C.muted }}>{r.icon} {r.symbol}</p>
                    <p className="text-xs font-semibold tabular-nums">${price.toFixed(2)}</p>
                    <Sparkline data={p.priceHistory} color={r.color} />
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2 mb-3">
              <button onClick={() => setMarketMode("swap")} className="flex-1 rounded-lg py-1.5 text-xs font-medium border transition" style={marketMode === "swap" ? { background: C.accent, color: "#050708", borderColor: C.accent } : { borderColor: C.border, color: C.muted }}>Swap</button>
              <button onClick={() => setMarketMode("liquidity")} className="flex-1 rounded-lg py-1.5 text-xs font-medium border transition" style={marketMode === "liquidity" ? { background: C.accent, color: "#050708", borderColor: C.accent } : { borderColor: C.border, color: C.muted }}>Provide Liquidity</button>
            </div>

            {marketMode === "swap" && (
              <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: C.border, background: C.bg }}>
                <div className="flex gap-2">
                  <button onClick={() => setSwapDirection("buy")} className="flex-1 rounded-lg py-1.5 text-xs font-medium border transition" style={swapDirection === "buy" ? { background: C.accent, color: "#050708", borderColor: C.accent } : { borderColor: C.border, color: C.muted }}>Buy {RESOURCES[swapTokenKey].symbol}</button>
                  <button onClick={() => setSwapDirection("sell")} className="flex-1 rounded-lg py-1.5 text-xs font-medium border transition" style={swapDirection === "sell" ? { background: C.accent, color: "#050708", borderColor: C.accent } : { borderColor: C.border, color: C.muted }}>Sell {RESOURCES[swapTokenKey].symbol}</button>
                </div>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" step="0.01" value={swapAmount} onChange={e => setSwapAmount(e.target.value)}
                    placeholder={swapDirection === "buy" ? "USD to spend" : `${RESOURCES[swapTokenKey].symbol} to sell`}
                    className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none" style={{ borderColor: C.border, background: C.elev, color: C.text }} />
                  <Btn onClick={() => runAction(executeSwap)} disabled={!isHumanTurn || !quote} tone="accent">Swap</Btn>
                </div>
                {quote && (
                  <p className="text-xs leading-5" style={{ color: C.muted }}>
                    ≈ {swapDirection === "buy" ? `${quote.amountOut.toFixed(3)} ${RESOURCES[swapTokenKey].symbol}` : `$${quote.amountOut.toFixed(2)}`} —
                    spot ${quote.spot.toFixed(3)} → exec ${quote.execPrice.toFixed(3)} <span style={{ color: quote.impact > 0.05 ? C.red : C.muted }}>({(quote.impact * 100).toFixed(1)}% impact)</span>
                    {quote.burnRate > 0 && <span style={{ color: C.orange }}> — 5% burned on sale</span>}
                  </p>
                )}
              </div>
            )}

            {marketMode === "liquidity" && (
              <div ref={registerRef("liquidity")} className="rounded-xl border p-3 space-y-3" style={{ borderColor: C.border, background: C.bg }}>
                {lpPositions[swapTokenKey] ? (() => {
                  const position = lpPositions[swapTokenKey], pool = pools[swapTokenKey], price = pool.usd / pool.token;
                  const shareFraction = position.shares / pool.lpTotalShares;
                  const currentValue = shareFraction * (pool.usd + pool.token * price);
                  const hodlValue = position.usdDeposited + position.tokenDeposited * price;
                  const diff = currentValue - hodlValue;
                  return (
                    <div className="space-y-2">
                      <p className="text-xs" style={{ color: C.muted }}>Position value: <span style={{ color: C.text }} className="font-medium">${currentValue.toFixed(2)}</span></p>
                      <p className="text-xs" style={{ color: C.muted }}>If you'd just held: <span style={{ color: C.text }} className="font-medium">${hodlValue.toFixed(2)}</span> <span style={{ color: diff >= 0 ? C.green : C.red }}>({diff >= 0 ? "+" : ""}{diff.toFixed(2)})</span></p>
                      <Btn onClick={() => runAction(removeLiquidity)} disabled={!isHumanTurn} tone="accent">Withdraw all</Btn>
                    </div>
                  );
                })() : (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" step="0.01" value={lpAmount} onChange={e => setLpAmount(e.target.value)} placeholder="USD to deposit (token matched automatically)"
                        className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none" style={{ borderColor: C.border, background: C.elev, color: C.text }} />
                      <Btn onClick={() => runAction(addLiquidity)} disabled={!isHumanTurn} tone="accent">Add</Btn>
                    </div>
                    <p className="text-[10px]" style={{ color: C.muted }}>Earns a share of every swap fee in this pool — value can end up below holding if price moves a lot. That's impermanent loss.</p>
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>

        {/* Fee flow */}
        <div>
          <SectionLabel>Fee flow</SectionLabel>
          <Card>
            {lastFeeSplit ? (
              <div className="space-y-2">
                <p className="text-xs" style={{ color: C.muted }}>Last fee: <span style={{ color: C.text }} className="font-medium">${lastFeeSplit.total.toFixed(4)}</span> on {lastFeeSplit.symbol}</p>
                <div className="h-3 w-full rounded-full overflow-hidden flex border" style={{ borderColor: C.border }}>
                  <div style={{ width: `${FEE_SPLIT.lp * 100}%`, background: C.green }} />
                  <div style={{ width: `${FEE_SPLIT.staker * 100}%`, background: C.accent }} />
                  <div style={{ width: `${FEE_SPLIT.treasury * 100}%`, background: C.purple }} />
                  <div style={{ width: `${FEE_SPLIT.burn * 100}%`, background: C.red }} />
                </div>
                <div className="grid grid-cols-4 gap-2 text-[10px]" style={{ color: C.muted }}>
                  <p>🟢 LP ${lastFeeSplit.lp.toFixed(4)}</p><p>🔵 Staker ${lastFeeSplit.staker.toFixed(4)}</p><p>🟣 Treasury ${lastFeeSplit.treasury.toFixed(4)}</p><p>🔴 Burn ${lastFeeSplit.burn.toFixed(4)}</p>
                </div>
              </div>
            ) : <p className="text-xs" style={{ color: C.muted }}>Any trade — yours or a bot's — will show the split here.</p>}
            {stakedCompound <= 0 && <p className="text-[10px] mt-2" style={{ color: C.accent }}>Stake a Genesis Alloy to start earning the staker slice of every swap fee — including bot trades.</p>}
          </Card>
        </div>

        {/* Genesis Alloy */}
        <div ref={registerRef("genesis")}>
        <Card glow={flashCard === "compound" || flashCard === "alloy"}>
          <SectionLabel>Genesis Alloy — $H + $He</SectionLabel>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs" style={{ color: C.muted }}>Costs {GENESIS_COST.hydrogen} H + {GENESIS_COST.helium} He</p>
            <div className="flex items-center gap-3">
              <p className="text-lg font-semibold tabular-nums" style={{ color: C.purple }}>{compound} <span className="text-[10px] font-normal" style={{ color: C.muted }}>liquid</span></p>
              <Btn onClick={() => runAction(combineGenesis)} disabled={!isHumanTurn || !canCombine} tone="accent">Combine</Btn>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t space-y-2" style={{ borderColor: C.border }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs" style={{ color: C.muted }}>Staked: <span style={{ color: C.accent }} className="font-semibold">{stakedCompound}</span></p>
              <div className="flex gap-2">
                <Btn onClick={() => runAction(stakeGenesis)} disabled={!isHumanTurn || compound <= 0} tone="accent" small>Stake all</Btn>
                <Btn onClick={() => runAction(unstakeGenesis)} disabled={!isHumanTurn || stakedCompound <= 0} small>Unstake all</Btn>
              </div>
            </div>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs" style={{ color: C.muted }}>Pending: <span style={{ color: C.green }} className="font-semibold">${pendingAlloyReward.toFixed(4)}</span></p>
              <Btn onClick={() => runAction(claimAlloyReward)} disabled={!isHumanTurn || pendingAlloyReward <= 0} tone="accent" small>Claim</Btn>
            </div>
          </div>
        </Card>
        </div>

        {/* Deuterium containment field — fixed APR, the opposite of Genesis Alloy staking */}
        <Card glow={flashCard === "deuterium"}>
          <SectionLabel>Deuterium Containment Field — fixed 10% APR</SectionLabel>
          <p className="text-xs mb-3" style={{ color: C.muted }}>
            Guaranteed. Stake D, wait {DEUTERIUM_EPOCH_TURNS} turns, get back exactly 10% of what you staked —
            whether the market moved at all. Unlike Genesis Alloy above, this never depends on anyone trading.
          </p>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <p className="text-xs" style={{ color: C.muted }}>Available: <span style={{ color: C.text }} className="font-medium">{elements.deuterium.toFixed(2)} D</span></p>
            <div className="flex items-center gap-2">
              <input type="number" min="0" step="0.1" value={deuteriumStakeInput} onChange={e => setDeuteriumStakeInput(e.target.value)}
                placeholder="D to stake" className="w-24 rounded-lg border px-2 py-1.5 text-xs outline-none" style={{ borderColor: C.border, background: C.bg, color: C.text }} />
              <Btn onClick={() => runAction(() => stakeDeuterium(parseFloat(deuteriumStakeInput)) && (setDeuteriumStakeInput("") || true))} disabled={!isHumanTurn || !parseFloat(deuteriumStakeInput)} tone="accent" small>Stake</Btn>
              <Btn onClick={() => runAction(unstakeDeuterium)} disabled={!isHumanTurn || deuteriumStaked <= 0} small>Unstake all</Btn>
            </div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <p className="text-xs" style={{ color: C.muted }}>Staked: <span style={{ color: C.accent }} className="font-semibold">{deuteriumStaked.toFixed(2)} D</span></p>
            <p className="text-[10px]" style={{ color: C.muted }}>epoch: {deuteriumEpochProgress}/{DEUTERIUM_EPOCH_TURNS} turns</p>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden mb-3" style={{ background: C.bg }}>
            <div className="h-full rounded-full transition-all duration-300" style={{ width: `${(deuteriumEpochProgress / DEUTERIUM_EPOCH_TURNS) * 100}%`, background: RESOURCES.deuterium.color }} />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-xs" style={{ color: C.muted }}>Pending: <span style={{ color: C.green }} className="font-semibold">{deuteriumPendingReward.toFixed(4)} D</span></p>
            <Btn onClick={() => runAction(claimDeuteriumReward)} disabled={!isHumanTurn || deuteriumPendingReward <= 0} tone="accent" small>Claim</Btn>
          </div>
        </Card>

        {/* Two-sided liquidity farming */}
        <div>
          <SectionLabel>Liquidity Farming — deposit both sides, earn a reward token</SectionLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(FARM_PAIRS).map(([key, pair]) => {
              const locked = pair.requiresSupernova && !fusion.wentSupernova;
              const pool = farmPools[key];
              const pos = farmPositions[key];
              const pending = farmPendingReward[key] || 0;
              const rewardResource = RESOURCES[pair.rewardKey];
              const depositVal = farmDepositInput[key] || "";
              return (
                <Card key={key}>
                  <p className="text-sm font-semibold mb-1">{RESOURCES[pair.tokenA].icon}{RESOURCES[pair.tokenB].icon} {pair.label}</p>
                  {locked ? (
                    <p className="text-[11px]" style={{ color: C.muted }}>Unlocks after your first supernova — the heavier elements need to exist first.</p>
                  ) : (
                    <>
                      <p className="text-[10px] mb-2" style={{ color: C.muted }}>
                        Deposit both sides, earn {rewardResource.symbol} every turn — an emission, not a fee cut. Have:{" "}
                        {(elements[pair.tokenA] || 0).toFixed(2)} {RESOURCES[pair.tokenA].symbol}, {(elements[pair.tokenB] || 0).toFixed(2)} {RESOURCES[pair.tokenB].symbol}.
                      </p>
                      <div className="flex items-center gap-2 mb-2">
                        <input type="number" min="0" step="0.1" value={depositVal}
                          onChange={e => setFarmDepositInput(prev => ({ ...prev, [key]: e.target.value }))}
                          placeholder={`${RESOURCES[pair.tokenA].symbol} to deposit`}
                          className="flex-1 rounded-lg border px-2 py-1.5 text-xs outline-none" style={{ borderColor: C.border, background: C.bg, color: C.text }} />
                        <Btn onClick={() => runAction(() => addFarmLiquidity(key, parseFloat(depositVal)) && (setFarmDepositInput(prev => ({ ...prev, [key]: "" })) || true))} disabled={!isHumanTurn || !parseFloat(depositVal)} tone="accent" small>Farm</Btn>
                      </div>
                      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                        <p className="text-[11px]" style={{ color: C.muted }}>Your shares: <span style={{ color: C.text }} className="font-medium">{(pos?.shares || 0).toFixed(2)}</span> / pool {pool.totalShares.toFixed(0)}</p>
                        <Btn onClick={() => runAction(() => toggleFarmAutoCompound(key))} disabled={!isHumanTurn || !pos} tone={pos?.autoCompound ? "accent" : "default"} small>
                          {pos?.autoCompound ? "Auto-compound on" : "Auto-compound off"}
                        </Btn>
                      </div>
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <p className="text-[11px]" style={{ color: C.muted }}>Pending: <span style={{ color: C.green }} className="font-semibold">{pending.toFixed(3)} {rewardResource.symbol}</span></p>
                        <Btn onClick={() => runAction(() => claimFarmReward(key))} disabled={!isHumanTurn || pending <= 0} tone="accent" small>Claim</Btn>
                      </div>
                    </>
                  )}
                </Card>
              );
            })}
          </div>
          <p className="text-[10px] mt-2" style={{ color: C.muted }}>
            Auto-compound sells half of every reward straight back into more liquidity — your share of the pool
            grows on its own. Leave it off and rewards just pile up for you to cash out by hand.
          </p>
        </div>

        {/* Governance */}
        <div ref={registerRef("governance")}>
        <Card glow={abiogenesisRatified}>
          <SectionLabel>Governance — required to create Life</SectionLabel>
          {abiogenesisRatified ? (
            <p className="text-xs" style={{ color: C.green }}>Abiogenesis ratified. Life can now be crafted below.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs" style={{ color: C.muted }}>
                Your voting weight: <span style={{ color: C.text }} className="font-medium">{Math.floor(elements.beryllium)} Be + {deadStars}×{DEAD_STAR_VOTE_WEIGHT} (dead stars) = {Math.floor(elements.beryllium) + deadStars * DEAD_STAR_VOTE_WEIGHT}</span>.
                The Treasury bloc votes no by default — a stalled star isn't wasted, it's political capital toward this vote.
              </p>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs" style={{ color: C.muted }}>{RESOURCES.beryllium.icon} {Math.floor(elements.beryllium)}/{PROPOSAL_COST} Beryllium needed to propose</p>
                <Btn onClick={() => runAction(proposeAbiogenesis)} disabled={!isHumanTurn || !canPropose} tone="accent" small>Propose ratification</Btn>
              </div>
            </div>
          )}
        </Card>
        </div>

        {/* Fusion / Life */}
        <div ref={registerRef("fusion")}>
          <SectionLabel>Fusion &amp; the race to Life</SectionLabel>
          <Card glow={fusion.readyForSupernova && !fusion.wentSupernova}>
            {!fusion.active && !fusion.wentSupernova && (
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs" style={{ color: C.muted }}>
                  Ignite for ${IGNITE_COST}. Your lifetime mass (${lifetimeMass.toFixed(2)}) would give a{" "}
                  <span style={{ color: C.text }} className="font-medium">{CLASS_CONFIG[classify(lifetimeMass)].label}</span>.
                </p>
                <Btn onClick={() => runAction(igniteStar)} disabled={!isHumanTurn || usd < IGNITE_COST} tone="accent">Ignite</Btn>
              </div>
            )}
            {fusion.active && !fusion.stalled && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{CLASS_CONFIG[fusion.class].icon} {CLASS_CONFIG[fusion.class].label}</p>
                  <p className="text-xs" style={{ color: C.muted }}>{fusion.stageIndex >= 0 ? FUSION_STAGES[fusion.stageIndex] : "not yet fusing"}</p>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: C.bg }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${((fusion.stageIndex + 1) / 7) * 100}%`, background: C.orange }} />
                </div>
                {!fusion.readyForSupernova && (
                  <p className="text-[10px]" style={{ color: C.muted }}>
                    next stage in {CLASS_CONFIG[fusion.class].turnsPerStage - (fusion.turnsInStage || 0)} turns
                  </p>
                )}
                {fusion.readyForSupernova && !fusion.wentSupernova && (
                  <Btn onClick={() => runAction(triggerSupernova)} disabled={!isHumanTurn} tone="accent">Trigger supernova</Btn>
                )}
              </div>
            )}
            {fusion.stalled && (
              <p className="text-xs" style={{ color: C.orange }}>This star stalled after {FUSION_STAGES[fusion.stageIndex]} and became a white dwarf. Gather more lifetime mass and ignite another.</p>
            )}

            <div className="mt-3 pt-3 border-t grid grid-cols-3 gap-2 text-center" style={{ borderColor: C.border }}>
              {ALL_ELEMENT_KEYS.filter(k => !POOL_KEYS.includes(k)).map(k => (
                <div key={k}>
                  <p className="text-sm">{RESOURCES[k].icon}</p>
                  <p className="text-[10px]" style={{ color: C.muted }}>{RESOURCES[k].symbol}</p>
                  <p className="text-xs font-semibold tabular-nums">{Math.floor(elements[k])}</p>
                </div>
              ))}
            </div>

            <div className="mt-3 pt-3 border-t space-y-3" style={{ borderColor: C.border }}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <Btn onClick={() => runAction(craftWater)} disabled={!isHumanTurn || elements.hydrogen < 2 || elements.oxygen < 1 || fluorineBurnedLifetime < FLUORINE_BURN_UNLOCK} small>Craft Water ({crafted.water})</Btn>
                <p className="text-[10px]" style={{ color: C.muted }}>needs 2 H + 1 O, and Fluorine burned</p>
              </div>

              {planetLock ? (
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <p className="text-xs" style={{ color: C.orange }}>Accreting a Planet — ready in {planetLockRemainingTurns} turns</p>
                  <Btn onClick={() => runAction(breakPlanetLock)} disabled={!isHumanTurn} small>Break lock early ({PLANET_LOCK_BREAK_RETURN * 100}% back)</Btn>
                </div>
              ) : (
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <Btn onClick={() => runAction(beginPlanetLock)} disabled={!isHumanTurn || !fusion.wentSupernova || elements.silicon < 2 || elements.oxygen < 2 || elements.magnesium < 1 || elements.iron < 1} small>Lock materials → Planet ({crafted.planet})</Btn>
                  <p className="text-[10px]" style={{ color: C.muted }}>needs 2 Si + 2 O + 1 Mg + 1 Fe, post-supernova, locked {PLANET_LOCK_MS / 1000}s</p>
                </div>
              )}

              <div className="flex items-center justify-between flex-wrap gap-2">
                <Btn onClick={() => runAction(craftLife)} disabled={!isHumanTurn || !abiogenesisRatified || crafted.planet < 1 || crafted.water < 1 || elements.carbon < 1 || elements.nitrogen < 1 || elements.phosphorus < 1 || elements.sulfur < 1} tone="accent" small>Craft Life</Btn>
                <p className="text-[10px]" style={{ color: C.muted }}>needs a Planet + Water + C + N + P + S, and a ratified vote</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Pass */}
        <Btn onClick={() => runAction(passTurn)} disabled={!isHumanTurn}>Pass turn</Btn>

        {/* Log */}
        <div>
          <SectionLabel>Activity log</SectionLabel>
          <Card className="max-h-64 overflow-y-auto space-y-1.5">
            {log.length === 0 && <p className="text-xs" style={{ color: C.muted }}>Nothing's happened yet.</p>}
            {log.map((entry, i) => <p key={entry.ts + i} className="text-xs leading-5" style={{ color: C.muted }}>{entry.text}</p>)}
          </Card>
        </div>
      </div>

      {/* Governance modal */}
      {showProposalModal && lastProposalResult && (
        <div onClick={() => setShowProposalModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 30 }} className="flex items-center justify-center px-5">
          <div onClick={e => e.stopPropagation()} className="rounded-2xl border p-6 max-w-sm text-center space-y-3" style={{ borderColor: C.accent, background: C.elev }}>
            <p className="text-3xl">🗝️</p>
            <h3 className="text-lg font-semibold">Proposal #{proposalsSubmitted} — {lastProposalResult.passed ? "Passed" : "Failed"}</h3>
            <div className="text-left text-xs space-y-1 leading-5" style={{ color: C.muted }}>
              <p>Your vote: <span style={{ color: C.text }}>{lastProposalResult.playerWeight} Be</span></p>
              {NPC_HOLDERS.map(n => <p key={n.name}>{n.name}: <span style={{ color: C.text }}>{n.be} Be</span> (voted {n.vote})</p>)}
              <p className="pt-1">Total voting power: {lastProposalResult.totalWeight} Be</p>
            </div>
            <Btn onClick={() => setShowProposalModal(false)} tone="accent">Close</Btn>
          </div>
        </div>
      )}

      {/* Tutorial overlay */}
      {tutorialActive && currentTutorialStep && (
        <TutorialOverlay
          step={currentTutorialStep}
          index={tutorialStep}
          total={TUTORIAL_STEPS.length}
          rect={highlightRect}
          onNext={nextTutorialStep}
          onBack={prevTutorialStep}
          onSkip={skipTutorial}
          canAdvance={canAdvanceTutorial}
          actionHint={currentTutorialStep.actionHint}
        />
      )}
    </main>
  );
}