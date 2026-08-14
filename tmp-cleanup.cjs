/**
 * One-off cleanup (approved 12 Aug 2026):
 *  1. Delete paper_closed_trades entered without an order book (pre-entry-gate era).
 *  2. Delete the adaptive_weights snapshot so weights rebuild from scratch.
 *  3. Delete paper_portfolios docs with no open position anywhere and no realised PnL;
 *     reset the portfolio on docs whose PnL came only from the deleted trades.
 *  4. Delete market_snapshots whose category is set and is not crypto.
 */
const { MongoClient } = require('mongodb');

function hasOpenPosition(state) {
  if (state.portfolio && state.portfolio.position) return true;
  const specs = state.specialistPortfolios || {};
  return Object.values(specs).some((p) => p && p.position);
}

function hasRealisedPnl(state) {
  if (state.portfolio && state.portfolio.realisedPnlUsd !== 0) return true;
  const specs = state.specialistPortfolios || {};
  return Object.values(specs).some((p) => p && p.realisedPnlUsd !== 0);
}

async function main() {
  const client = new MongoClient('mongodb://127.0.0.1:27017/');
  await client.connect();
  const db = client.db('PMTrader');

  // --- 1. Closed trades without an order book at entry ---
  const trades = db.collection('paper_closed_trades');
  const tradesBefore = await trades.countDocuments();
  const bookless = await trades.countDocuments({ 'entryConditions.hadOrderbook': false });
  const tradesResult = await trades.deleteMany({ 'entryConditions.hadOrderbook': false });
  console.log(`closed trades: ${tradesBefore} total, ${bookless} book-less, deleted ${tradesResult.deletedCount}, remaining ${await trades.countDocuments()}`);

  // --- 2. Adaptive snapshot ---
  const adaptive = db.collection('adaptive_weights');
  const adaptiveResult = await adaptive.deleteMany({});
  console.log(`adaptive snapshots deleted: ${adaptiveResult.deletedCount}`);

  // --- 3. Paper market states ---
  const portfolios = db.collection('paper_portfolios');
  const statesBefore = await portfolios.countDocuments();
  const all = await portfolios.find({}).toArray();
  const deadIds = [];
  const resetIds = [];
  for (const state of all) {
    if (hasOpenPosition(state)) continue; // never touch a live position
    if (hasRealisedPnl(state)) resetIds.push(state._id);
    else deadIds.push(state._id);
  }
  let deletedStates = 0;
  for (let i = 0; i < deadIds.length; i += 1000) {
    const chunk = deadIds.slice(i, i + 1000);
    const res = await portfolios.deleteMany({ _id: { $in: chunk } });
    deletedStates += res.deletedCount;
  }
  // Zero the phantom PnL that belonged to the deleted trades.
  const emptyPortfolio = { position: null, realisedPnlUsd: 0, estimatedCostsUsd: 0 };
  let resetStates = 0;
  for (const id of resetIds) {
    const state = all.find((s) => String(s._id) === String(id));
    const specs = {};
    for (const key of Object.keys(state.specialistPortfolios || {})) {
      specs[key] = { ...emptyPortfolio };
    }
    const res = await portfolios.updateOne(
      { _id: id },
      {
        $set: {
          portfolio: { ...emptyPortfolio },
          specialistPortfolios: specs,
          entryMeta: null,
          specialistEntryMeta: {},
          unrealisedPnlUsd: null,
          updatedAt: new Date().toISOString(),
        },
      },
    );
    resetStates += res.modifiedCount;
  }
  console.log(`market states: ${statesBefore} before, deleted ${deletedStates} dead, reset PnL on ${resetStates}, remaining ${await portfolios.countDocuments()}`);

  // --- 4. Non-crypto market snapshots ---
  const snapshots = db.collection('market_snapshots');
  const snapsBefore = await snapshots.countDocuments();
  const categories = await snapshots.distinct('category');
  console.log('distinct categories:', JSON.stringify(categories));
  const nonCrypto = { category: { $exists: true, $nin: [null, 'crypto', 'Crypto', 'CRYPTO'] } };
  const nonCryptoCount = await snapshots.countDocuments(nonCrypto);
  const snapsResult = await snapshots.deleteMany(nonCrypto);
  console.log(`market snapshots: ${snapsBefore} before, ${nonCryptoCount} non-crypto, deleted ${snapsResult.deletedCount}, remaining ${await snapshots.countDocuments()}`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
