import { Router } from 'express';
import { getEventsCatalog } from '../jupiter/catalog.js';
import { jupiter } from '../jupiter/index.js';
import { parseOptionalInt, queryString, sendJupiterError } from './jupiter-error.js';

export const eventsRouter = Router();

/**
 * Full Jupiter catalog: every category, open markets, paginated server-side.
 * Cached in MongoDB; stale snapshots are returned immediately while Jupiter
 * refreshes in the background. Pass ?refresh=true to force a background refresh.
 */
eventsRouter.get('/catalog', async (req, res) => {
  const refresh = req.query['refresh'] === 'true';

  try {
    const result = await getEventsCatalog({ refresh });
    res.json(result);
  } catch (error) {
    sendJupiterError(res, error);
  }
});

/**
 * List prediction events from Jupiter.
 * Query: category, filter, includeMarkets, start, end, etc.
 */
eventsRouter.get('/', async (req, res) => {
  const query = queryString(req, [
    'category',
    'subcategory',
    'tags',
    'filter',
    'sortBy',
    'sortDirection',
    'includeMarkets',
    'includeAllMarkets',
  ]);

  const start = parseOptionalInt(req.query['start']);
  const end = parseOptionalInt(req.query['end']);
  if (start !== undefined) {
    query['start'] = String(start);
  }
  if (end !== undefined) {
    query['end'] = String(end);
  }

  if (!query['includeMarkets']) {
    query['includeMarkets'] = 'true';
  }

  try {
    const result = await jupiter.getEvents(query);
    res.json(result);
  } catch (error) {
    sendJupiterError(res, error);
  }
});
